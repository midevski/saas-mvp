import type { Types } from 'mongoose'
import { NotFoundError } from '../../lib/errors'
import { Board, type BoardDocument } from './board.model'
import { deleteImage } from '../../uploads/storage'
import { systemEntry } from './activity.service'
import {
  Card,
  type ActivityEntryDocument,
  type AttachmentDocument,
  type CardDocument,
  type ChecklistDocument,
} from './card.model'
import { Column, type ColumnDocument } from './column.model'

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done']

type WithId<T> = T & { _id: Types.ObjectId }

export interface CardDTO {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string | null
  order: number
  createdBy: string
  attachments: AttachmentDTO[]
  checklists: ChecklistDTO[]
  createdAt: Date
  updatedAt: Date
}

// The storage publicId stays server-side; clients only need the URL
export interface AttachmentDTO {
  id: string
  url: string
  filename: string
  uploadedBy: string
  uploadedAt: Date
}

function toAttachmentDTO(attachment: AttachmentDocument): AttachmentDTO {
  return {
    id: attachment._id.toString(),
    url: attachment.url,
    filename: attachment.filename,
    uploadedBy: attachment.uploadedBy.toString(),
    uploadedAt: attachment.uploadedAt,
  }
}

export interface ChecklistItemDTO {
  id: string
  text: string
  completed: boolean
  completedBy: string | null
  completedAt: Date | null
}

export interface ChecklistDTO {
  id: string
  title: string
  items: ChecklistItemDTO[]
}

function toChecklistDTO(checklist: ChecklistDocument): ChecklistDTO {
  return {
    id: checklist._id.toString(),
    title: checklist.title,
    items: (checklist.items ?? []).map((item) => ({
      id: item._id.toString(),
      text: item.text,
      completed: item.completed,
      completedBy: item.completedBy ? item.completedBy.toString() : null,
      completedAt: item.completedAt,
    })),
  }
}

export function toCardDTO(card: WithId<CardDocument>): CardDTO {
  return {
    id: card._id.toString(),
    boardId: card.boardId.toString(),
    columnId: card.columnId.toString(),
    title: card.title,
    description: card.description,
    order: card.order,
    createdBy: card.createdBy.toString(),
    attachments: (card.attachments ?? []).map(toAttachmentDTO),
    checklists: (card.checklists ?? []).map(toChecklistDTO),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }
}

export function toColumnDTO(column: WithId<ColumnDocument>) {
  return { id: column._id.toString(), name: column.name, order: column.order }
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

export async function getOrCreateBoardForOrg(orgId: string): Promise<WithId<BoardDocument>> {
  let result
  try {
    result = await Board.findOneAndUpdate(
      { orgId },
      { $setOnInsert: { orgId, name: 'Board' } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: true },
    )
  } catch (err) {
    // Two first-time requests raced on the unique orgId index — the other one created it
    if (!isDuplicateKeyError(err)) throw err
    return (await Board.findOne({ orgId }))!
  }

  const board = result.value!
  if (!result.lastErrorObject?.updatedExisting) {
    await Column.insertMany(
      DEFAULT_COLUMNS.map((name, order) => ({ boardId: board._id, name, order })),
    )
  }
  return board
}

export async function getBoardState(orgId: string) {
  const board = await getOrCreateBoardForOrg(orgId)
  const [columns, cards] = await Promise.all([
    Column.find({ boardId: board._id }).sort({ order: 1, _id: 1 }),
    Card.find({ boardId: board._id }).sort({ order: 1 }),
  ])
  return {
    board: { id: board._id.toString(), name: board.name },
    columns: columns.map(toColumnDTO),
    cards: cards.map(toCardDTO),
  }
}

// Used by the realtime layer to find which org to permission-check against —
// the orgId always comes from the DB, never from the client payload.
export async function getOrgIdForBoard(boardId: string): Promise<string | null> {
  const board = await Board.findById(boardId).select('orgId')
  return board ? board.orgId.toString() : null
}

export async function getOrgIdForCard(cardId: string): Promise<string | null> {
  const card = await Card.findById(cardId).select('boardId')
  if (!card) return null
  return getOrgIdForBoard(card.boardId.toString())
}

export async function createCard(
  boardId: string,
  columnId: string,
  title: string,
  userId: string,
): Promise<CardDTO> {
  const column = await Column.findOne({ _id: columnId, boardId })
  if (!column) throw new NotFoundError('Column not found')

  // Append to the bottom of the column
  const order = await Card.countDocuments({ columnId })
  const card = await Card.create({
    boardId,
    columnId,
    title,
    order,
    createdBy: userId,
    activity: [systemEntry(userId, 'created this card')],
  })
  return toCardDTO(card)
}

// Shared by cards (position within a column) and columns (position on the board): rewrite the
// given documents' `order` to 0..n-1 in the order the ids are listed
export async function writeOrder(
  model: typeof Card | typeof Column,
  ids: Types.ObjectId[],
  extraSet: Record<string, unknown> = {},
) {
  if (ids.length === 0) return
  const ops = ids.map((_id, order) => ({ updateOne: { filter: { _id }, update: { $set: { order, ...extraSet } } } }))
  await (model as typeof Card).bulkWrite(ops)
}

// Insert `id` into `ids` at `toOrder` (clamped to the ends); returns the new list and the index used
export function spliceAt(ids: Types.ObjectId[], id: Types.ObjectId, toOrder: number) {
  const index = Math.max(0, Math.min(toOrder, ids.length))
  const next = [...ids]
  next.splice(index, 0, id)
  return { ids: next, index }
}

// Ordering strategy: integer re-sequencing. On every move, the affected column(s) are
// rewritten to 0..n-1. It costs one bulkWrite per move, which is fine at kanban scale,
// and it's trivially deterministic — clients apply the exact same splice locally.
// Deletes may leave gaps; harmless, since only relative order matters and moves re-sequence.
// Moving to another column logs a system entry (reordering within a column doesn't — it's noise)
export async function moveCard(
  cardId: string,
  toColumnId: string,
  toOrder: number,
  userId: string,
): Promise<{ card: CardDTO; toOrder: number; fromColumnId: string; activity: ActivityEntryDocument | null }> {
  const card = await Card.findById(cardId)
  if (!card) throw new NotFoundError('Card not found')

  const toColumn = await Column.findOne({ _id: toColumnId, boardId: card.boardId })
  if (!toColumn) throw new NotFoundError('Column not found')

  const fromColumnId = card.columnId

  const siblings = await Card.find({ columnId: toColumn._id, _id: { $ne: card._id } })
    .sort({ order: 1 })
    .select('_id')
  const { ids: targetIds, index } = spliceAt(
    siblings.map((s) => s._id),
    card._id,
    toOrder,
  )

  let activity: ActivityEntryDocument | null = null
  if (!fromColumnId.equals(toColumn._id)) {
    const fromColumn = await Column.findById(fromColumnId).select('name')
    activity = systemEntry(userId, `moved this card from ${fromColumn?.name ?? 'a deleted column'} to ${toColumn.name}`)
  }

  await Card.updateOne(
    { _id: card._id },
    { $set: { columnId: toColumn._id }, ...(activity ? { $push: { activity } } : {}) },
  )
  await writeOrder(Card, targetIds)

  if (!fromColumnId.equals(toColumn._id)) {
    const remaining = await Card.find({ columnId: fromColumnId }).sort({ order: 1 }).select('_id')
    await writeOrder(
      Card,
      remaining.map((c) => c._id),
    )
  }

  const updated = (await Card.findById(card._id))!
  return { card: toCardDTO(updated), toOrder: index, fromColumnId: fromColumnId.toString(), activity }
}

// Logs that the title/description changed, not the diff — feed entries stay short. Saving
// without actually changing anything logs nothing.
export async function updateCard(
  cardId: string,
  changes: { title?: string | undefined; description?: string | null | undefined },
  userId: string,
): Promise<{ card: CardDTO; activity: ActivityEntryDocument | null }> {
  const current = await Card.findById(cardId).select('title description')
  if (!current) throw new NotFoundError('Card not found')

  const set: Record<string, unknown> = {}
  const changed: string[] = []
  if (changes.title !== undefined) {
    set.title = changes.title
    if (changes.title !== current.title) changed.push('title')
  }
  if (changes.description !== undefined) {
    set.description = changes.description
    if (changes.description !== current.description) changed.push('description')
  }
  const activity = changed.length > 0 ? systemEntry(userId, `updated the ${changed.join(' and ')}`) : null

  const card = await Card.findByIdAndUpdate(
    cardId,
    { $set: set, ...(activity ? { $push: { activity } } : {}) },
    { returnDocument: 'after' },
  )
  if (!card) throw new NotFoundError('Card not found')
  return { card: toCardDTO(card), activity }
}

export async function deleteCard(cardId: string): Promise<{ cardId: string; columnId: string }> {
  const card = await Card.findByIdAndDelete(cardId)
  if (!card) throw new NotFoundError('Card not found')
  // Don't leave the card's images orphaned in storage (best-effort: the card is already gone)
  for (const attachment of card.attachments ?? []) {
    deleteImage(attachment.publicId).catch((err: Error) =>
      console.error(`[uploads] could not delete ${attachment.publicId}: ${err.message}`),
    )
  }
  return { cardId, columnId: card.columnId.toString() }
}

// For deleting an org: its board, columns and cards — and the cards' images in storage
export async function deleteBoardForOrg(orgId: string): Promise<void> {
  const board = await Board.findOne({ orgId })
  if (!board) return
  const cards = await Card.find({ boardId: board._id }).select('attachments')
  await Card.deleteMany({ boardId: board._id })
  await Column.deleteMany({ boardId: board._id })
  await Board.deleteOne({ _id: board._id })
  // Best-effort: the data is already gone; a storage hiccup only leaves an orphaned file
  for (const attachment of cards.flatMap((c) => c.attachments ?? [])) {
    deleteImage(attachment.publicId).catch((err: Error) =>
      console.error(`[uploads] could not delete ${attachment.publicId}: ${err.message}`),
    )
  }
}

export async function addAttachment(
  cardId: string,
  attachment: { url: string; publicId: string; filename: string; uploadedBy: string },
): Promise<{ card: CardDTO; attachment: AttachmentDTO; activity: ActivityEntryDocument }> {
  const activity = systemEntry(attachment.uploadedBy, 'added an image')
  const card = await Card.findByIdAndUpdate(
    cardId,
    { $push: { attachments: { ...attachment, uploadedAt: new Date() }, activity } },
    { returnDocument: 'after' },
  )
  if (!card) throw new NotFoundError('Card not found')
  const added = card.attachments[card.attachments.length - 1]!
  return { card: toCardDTO(card), attachment: toAttachmentDTO(added), activity }
}

// Removes one attachment and returns its storage id so the caller can delete the file
export async function removeAttachment(
  cardId: string,
  attachmentId: string,
  userId: string,
): Promise<{ card: CardDTO; publicId: string; activity: ActivityEntryDocument }> {
  const existing = await Card.findOne({ _id: cardId, 'attachments._id': attachmentId }, { 'attachments.$': 1 })
  const target = existing?.attachments[0]
  if (!target) throw new NotFoundError('Attachment not found')

  const activity = systemEntry(userId, 'removed an image')
  // Filtered on the attachment too, so two people removing the same image log it once
  const card = await Card.findOneAndUpdate(
    { _id: cardId, 'attachments._id': attachmentId },
    { $pull: { attachments: { _id: attachmentId } }, $push: { activity } },
    { returnDocument: 'after' },
  )
  if (!card) throw new NotFoundError('Attachment not found')
  return { card: toCardDTO(card), publicId: target.publicId, activity }
}
