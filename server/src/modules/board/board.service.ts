import type { Types } from 'mongoose'
import { NotFoundError } from '../../lib/errors'
import { Board, type BoardDocument } from './board.model'
import { Card, type CardDocument } from './card.model'
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
  createdAt: Date
  updatedAt: Date
}

function toCardDTO(card: WithId<CardDocument>): CardDTO {
  return {
    id: card._id.toString(),
    boardId: card.boardId.toString(),
    columnId: card.columnId.toString(),
    title: card.title,
    description: card.description,
    order: card.order,
    createdBy: card.createdBy.toString(),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }
}

function toColumnDTO(column: WithId<ColumnDocument>) {
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
    Column.find({ boardId: board._id }).sort({ order: 1 }),
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
  const card = await Card.create({ boardId, columnId, title, order, createdBy: userId })
  return toCardDTO(card)
}

async function writeOrder(ids: Types.ObjectId[], extraSet: Record<string, unknown> = {}) {
  if (ids.length === 0) return
  await Card.bulkWrite(
    ids.map((_id, order) => ({ updateOne: { filter: { _id }, update: { $set: { order, ...extraSet } } } })),
  )
}

// Ordering strategy: integer re-sequencing. On every move, the affected column(s) are
// rewritten to 0..n-1. It costs one bulkWrite per move, which is fine at kanban scale,
// and it's trivially deterministic — clients apply the exact same splice locally.
// Deletes may leave gaps; harmless, since only relative order matters and moves re-sequence.
export async function moveCard(
  cardId: string,
  toColumnId: string,
  toOrder: number,
): Promise<{ card: CardDTO; toOrder: number; fromColumnId: string }> {
  const card = await Card.findById(cardId)
  if (!card) throw new NotFoundError('Card not found')

  const toColumn = await Column.findOne({ _id: toColumnId, boardId: card.boardId })
  if (!toColumn) throw new NotFoundError('Column not found')

  const fromColumnId = card.columnId

  const siblings = await Card.find({ columnId: toColumn._id, _id: { $ne: card._id } })
    .sort({ order: 1 })
    .select('_id')
  const index = Math.max(0, Math.min(toOrder, siblings.length))
  const targetIds = siblings.map((s) => s._id)
  targetIds.splice(index, 0, card._id)

  await Card.updateOne({ _id: card._id }, { $set: { columnId: toColumn._id } })
  await writeOrder(targetIds)

  if (!fromColumnId.equals(toColumn._id)) {
    const remaining = await Card.find({ columnId: fromColumnId }).sort({ order: 1 }).select('_id')
    await writeOrder(remaining.map((c) => c._id))
  }

  const updated = (await Card.findById(card._id))!
  return { card: toCardDTO(updated), toOrder: index, fromColumnId: fromColumnId.toString() }
}

export async function updateCard(
  cardId: string,
  changes: { title?: string | undefined; description?: string | null | undefined },
): Promise<CardDTO> {
  const set: Record<string, unknown> = {}
  if (changes.title !== undefined) set.title = changes.title
  if (changes.description !== undefined) set.description = changes.description

  const card = await Card.findByIdAndUpdate(cardId, { $set: set }, { returnDocument: 'after' })
  if (!card) throw new NotFoundError('Card not found')
  return toCardDTO(card)
}

export async function deleteCard(cardId: string): Promise<{ cardId: string; columnId: string }> {
  const card = await Card.findByIdAndDelete(cardId)
  if (!card) throw new NotFoundError('Card not found')
  return { cardId, columnId: card.columnId.toString() }
}
