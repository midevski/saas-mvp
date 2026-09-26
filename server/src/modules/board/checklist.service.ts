import { Types } from 'mongoose'
import { ConflictError, NotFoundError } from '../../lib/errors'
import { toCardDTO, type CardDTO } from './board.service'
import { Card } from './card.model'

// Every mutation is one atomic update with positional operators / arrayFilters, so two people
// changing different items of the same card at the same moment can't overwrite each other
// (a load-modify-save would). Each filter also proves the target exists: no match -> 404.

export const MAX_CHECKLISTS_PER_CARD = 20
export const MAX_ITEMS_PER_CHECKLIST = 200

const id = (value: string) => new Types.ObjectId(value)

async function explainMiss(cardId: string, checklistId?: string, itemId?: string): Promise<never> {
  if (!(await Card.exists({ _id: cardId }))) throw new NotFoundError('Card not found')
  if (checklistId && !(await Card.exists({ _id: cardId, 'checklists._id': checklistId }))) {
    throw new NotFoundError('Checklist not found')
  }
  if (itemId) throw new NotFoundError('Checklist item not found')
  throw new ConflictError('Limit reached')
}

async function done(card: Parameters<typeof toCardDTO>[0] | null, ...where: [string, string?, string?]) {
  if (!card) return explainMiss(...where)
  return toCardDTO(card)
}

export async function addChecklist(cardId: string, title: string): Promise<CardDTO> {
  const card = await Card.findOneAndUpdate(
    // Only if there's still room for one more
    { _id: cardId, [`checklists.${MAX_CHECKLISTS_PER_CARD - 1}`]: { $exists: false } },
    { $push: { checklists: { title, items: [] } } },
    { returnDocument: 'after' },
  )
  if (!card && (await Card.exists({ _id: cardId }))) {
    throw new ConflictError(`A card can have at most ${MAX_CHECKLISTS_PER_CARD} checklists`)
  }
  return done(card, cardId)
}

export async function renameChecklist(cardId: string, checklistId: string, title: string): Promise<CardDTO> {
  const card = await Card.findOneAndUpdate(
    { _id: cardId, 'checklists._id': checklistId },
    { $set: { 'checklists.$.title': title } },
    { returnDocument: 'after' },
  )
  return done(card, cardId, checklistId)
}

export async function deleteChecklist(cardId: string, checklistId: string): Promise<CardDTO> {
  // Removes the checklist and all of its items together
  const card = await Card.findOneAndUpdate(
    { _id: cardId, 'checklists._id': checklistId },
    { $pull: { checklists: { _id: id(checklistId) } } },
    { returnDocument: 'after' },
  )
  return done(card, cardId, checklistId)
}

export async function addItem(cardId: string, checklistId: string, text: string): Promise<CardDTO> {
  const card = await Card.findOneAndUpdate(
    {
      _id: cardId,
      checklists: {
        $elemMatch: { _id: id(checklistId), [`items.${MAX_ITEMS_PER_CHECKLIST - 1}`]: { $exists: false } },
      },
    },
    { $push: { 'checklists.$.items': { text, completed: false, completedBy: null, completedAt: null } } },
    { returnDocument: 'after' },
  )
  if (!card && (await Card.exists({ _id: cardId, 'checklists._id': checklistId }))) {
    throw new ConflictError(`A checklist can have at most ${MAX_ITEMS_PER_CHECKLIST} items`)
  }
  return done(card, cardId, checklistId)
}

// Covers renaming and toggling. completedBy/completedAt come from the authenticated user and
// are only written when `completed` actually flips — re-checking a checked item keeps the
// original who/when; unchecking clears both.
export async function updateItem(
  cardId: string,
  checklistId: string,
  itemId: string,
  changes: { text?: string | undefined; completed?: boolean | undefined },
  userId: string,
): Promise<CardDTO> {
  // MongoDB rejects unused array filters, so each part adds only the identifiers it uses
  const set: Record<string, unknown> = {}
  const arrayFilters: Record<string, unknown>[] = []

  if (changes.text !== undefined) {
    set['checklists.$[cl].items.$[it].text'] = changes.text
    arrayFilters.push({ 'cl._id': id(checklistId) }, { 'it._id': id(itemId) })
  }
  if (changes.completed !== undefined) {
    const flipTo = changes.completed
    set['checklists.$[flip].items.$[flipItem].completed'] = flipTo
    set['checklists.$[flip].items.$[flipItem].completedBy'] = flipTo ? id(userId) : null
    set['checklists.$[flip].items.$[flipItem].completedAt'] = flipTo ? new Date() : null
    // Only matches if the item is currently in the *other* state
    arrayFilters.push({ 'flip._id': id(checklistId) }, { 'flipItem._id': id(itemId), 'flipItem.completed': !flipTo })
  }

  const card = await Card.findOneAndUpdate(
    { _id: cardId, checklists: { $elemMatch: { _id: id(checklistId), 'items._id': id(itemId) } } },
    { $set: set },
    { arrayFilters, returnDocument: 'after' },
  )
  return done(card, cardId, checklistId, itemId)
}

export async function deleteItem(cardId: string, checklistId: string, itemId: string): Promise<CardDTO> {
  const card = await Card.findOneAndUpdate(
    { _id: cardId, checklists: { $elemMatch: { _id: id(checklistId), 'items._id': id(itemId) } } },
    { $pull: { 'checklists.$[cl].items': { _id: id(itemId) } } },
    { arrayFilters: [{ 'cl._id': id(checklistId) }], returnDocument: 'after' },
  )
  return done(card, cardId, checklistId, itemId)
}
