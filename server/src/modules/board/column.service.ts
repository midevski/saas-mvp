import { NotFoundError, ValidationError } from '../../lib/errors'
import { deleteImage } from '../../uploads/storage'
import { Board } from './board.model'
import { toCardDTO, toColumnDTO, writeOrder, type CardDTO } from './board.service'
import { systemEntry } from './activity.service'
import { Card, type ActivityEntryDocument } from './card.model'
import { Column } from './column.model'

export type ColumnDTO = ReturnType<typeof toColumnDTO>

// The org to permission-check against always comes from the DB, never from the client
export async function getOrgIdForColumn(columnId: string): Promise<string | null> {
  const column = await Column.findById(columnId).select('boardId')
  if (!column) return null
  const board = await Board.findById(column.boardId).select('orgId')
  return board ? board.orgId.toString() : null
}

// Column `order` is the board's *default* layout (creation order, gaps closed after deletes).
// Each viewer can reorder columns for themselves; that's kept in their browser, not here.

// New columns go at the end of the row
export async function createColumn(boardId: string, name: string): Promise<ColumnDTO> {
  const last = await Column.findOne({ boardId }).sort({ order: -1 }).select('order')
  const column = await Column.create({ boardId, name, order: last ? last.order + 1 : 0 })
  return toColumnDTO(column)
}

export async function renameColumn(columnId: string, name: string): Promise<ColumnDTO> {
  const column = await Column.findByIdAndUpdate(columnId, { $set: { name } }, { returnDocument: 'after' })
  if (!column) throw new NotFoundError('Column not found')
  return toColumnDTO(column)
}

export interface DeletedColumn {
  columnId: string
  // Present when the cards were moved: their new state (column + position), for clients to apply
  movedCards?: CardDTO[]
  // Present when the cards were deleted along with the column
  deletedCardIds?: string[]
}

// Deletes a column. Its cards are either moved to the end of another column on the same board
// (keeping their order), or deleted with it — including their images in storage. Moved cards
// each get a "moved" entry in their feed, returned for the caller to publish.
export async function deleteColumn(
  columnId: string,
  userId: string,
  moveCardsTo?: string,
): Promise<{ deleted: DeletedColumn; activity: { cardId: string; entry: ActivityEntryDocument }[] }> {
  const column = await Column.findById(columnId)
  if (!column) throw new NotFoundError('Column not found')

  let target = null
  if (moveCardsTo) {
    if (moveCardsTo === columnId) throw new ValidationError("Can't move cards into the column being deleted")
    target = await Column.findOne({ _id: moveCardsTo, boardId: column.boardId })
    if (!target) throw new NotFoundError('Destination column not found')
  }

  const cards = await Card.find({ columnId: column._id }).sort({ order: 1, _id: 1 })
  const result: DeletedColumn = { columnId }
  const activity: { cardId: string; entry: ActivityEntryDocument }[] = []

  if (target) {
    const alreadyThere = await Card.find({ columnId: target._id }).sort({ order: 1, _id: 1 }).select('_id')
    // One entry, logged on every moved card in the same write that moves them (entry ids only
    // need to be unique within a card's own feed)
    const entry = systemEntry(userId, `moved this card from ${column.name} to ${target.name} (${column.name} was deleted)`)
    await Card.updateMany({ columnId: column._id }, { $set: { columnId: target._id }, $push: { activity: entry } })
    for (const card of cards) activity.push({ cardId: card._id.toString(), entry })
    await writeOrder(Card, [...alreadyThere.map((c) => c._id), ...cards.map((c) => c._id)])
    const moved = await Card.find({ _id: { $in: cards.map((c) => c._id) } }).sort({ order: 1, _id: 1 })
    result.movedCards = moved.map(toCardDTO)
  } else {
    await Card.deleteMany({ columnId: column._id })
    result.deletedCardIds = cards.map((c) => c._id.toString())
    // Don't leave their images orphaned in storage (best-effort: the cards are already gone)
    for (const attachment of cards.flatMap((c) => c.attachments ?? [])) {
      deleteImage(attachment.publicId).catch((err: Error) =>
        console.error(`[uploads] could not delete ${attachment.publicId}: ${err.message}`),
      )
    }
  }

  await Column.deleteOne({ _id: column._id })
  // A card created in this column while it was being deleted would be stranded — sweep it too
  if (target) await Card.updateMany({ columnId: column._id }, { $set: { columnId: target._id } })
  else await Card.deleteMany({ columnId: column._id })

  const remaining = await Column.find({ boardId: column.boardId }).sort({ order: 1, _id: 1 }).select('_id')
  await writeOrder(
    Column,
    remaining.map((c) => c._id),
  )
  return { deleted: result, activity }
}
