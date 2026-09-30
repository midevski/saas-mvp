import { Types } from 'mongoose'
import { NotFoundError } from '../../lib/errors'
import { CARD_ACTIVITY } from '../../realtime/events'
import { emitToOrg } from '../../realtime/emitter'
import { User } from '../users/user.model'
import { Card, type ActivityEntryDocument, type ActivityType } from './card.model'

// A card's feed: comments and system entries in one append-only, chronological array.
// System entries are pushed by the same DB update as the change they describe (see
// board.service / checklist.service / column.service), so a change and its log line can't
// drift apart.

export interface ActivityDTO {
  id: string
  type: ActivityType
  // Resolved server-side so the feed can name people who have since left the org
  author: { id: string; name: string } | null
  text: string
  mentions: { id: string; name: string }[]
  createdAt: Date
}

export function activityEntry(
  type: ActivityType,
  authorId: string | null,
  text: string,
  mentions: string[] = [],
): ActivityEntryDocument {
  return {
    _id: new Types.ObjectId(),
    type,
    authorId: authorId ? new Types.ObjectId(authorId) : null,
    text,
    mentions: mentions.map((id) => new Types.ObjectId(id)),
    createdAt: new Date(),
  }
}

// The user who triggered the change is its author ("Sarah moved this card to Done")
export function systemEntry(userId: string, text: string) {
  return activityEntry('system', userId, text)
}

// Keeps system lines short and scannable when they quote user text (e.g. a checklist item)
export function quote(text: string, max = 80) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return `'${oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine}'`
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

// Finds `@Display Name` mentions of the given people. Case-insensitive, whole names only: an
// '@' must start a word (so "me@example.com" isn't a mention) and the name must end at a word
// boundary (so "@Sam" doesn't match inside "@Samuel"). The longest name wins when several fit
// ("@Sam Lee" over "@Sam"). A typo or a non-member's name simply doesn't match.
// Mirrored in client/src/lib/mentions.ts, which uses it to highlight stored mentions.
export function findMentions(text: string, people: { id: string; name: string }[]) {
  const candidates = people
    .map((p) => ({ id: p.id, name: p.name.trim() }))
    .filter((p) => p.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  const found: { id: string; start: number; end: number }[] = []
  let at = text.indexOf('@')
  while (at !== -1) {
    let next = at + 1
    if (at === 0 || !WORD_CHAR.test(text[at - 1]!)) {
      const match = candidates.find((c) => {
        const end = at + 1 + c.name.length
        return (
          text.slice(at + 1, end).toLowerCase() === c.name.toLowerCase() && !WORD_CHAR.test(text[end] ?? '')
        )
      })
      if (match) {
        next = at + 1 + match.name.length
        found.push({ id: match.id, start: at, end: next })
      }
    }
    at = text.indexOf('@', next)
  }
  return found
}

export async function toActivityDTOs(entries: ActivityEntryDocument[]): Promise<ActivityDTO[]> {
  const userIds = new Set<string>()
  for (const entry of entries) {
    if (entry.authorId) userIds.add(entry.authorId.toString())
    for (const id of entry.mentions ?? []) userIds.add(id.toString())
  }
  const users = await User.find({ _id: { $in: [...userIds] } }).select('name')
  const nameById = new Map(users.map((u) => [u.id as string, u.name]))
  const person = (id: Types.ObjectId) => ({ id: id.toString(), name: nameById.get(id.toString()) ?? 'Former user' })

  return entries.map((entry) => ({
    id: entry._id.toString(),
    type: entry.type,
    author: entry.authorId ? person(entry.authorId) : null,
    text: entry.text,
    mentions: (entry.mentions ?? []).map(person),
    createdAt: entry.createdAt,
  }))
}

// Oldest first (the order they happened); the client decides how to display it
export async function listActivity(cardId: string): Promise<ActivityDTO[]> {
  const card = await Card.findById(cardId).select('+activity')
  if (!card) throw new NotFoundError('Card not found')
  return toActivityDTOs(card.activity ?? [])
}

// Append-only on purpose: there is no edit or delete for comments (yet)
export async function addComment(
  cardId: string,
  userId: string,
  text: string,
  mentionedUserIds: string[],
): Promise<ActivityEntryDocument> {
  const entry = activityEntry('comment', userId, text, [...new Set(mentionedUserIds)])
  const updated = await Card.updateOne({ _id: cardId }, { $push: { activity: entry } })
  if (updated.matchedCount === 0) throw new NotFoundError('Card not found')
  return entry
}

// Tells everyone on the board — including whoever triggered it; clients de-duplicate by id.
// A lighter event than card:updated: open feeds append the one entry.
export async function publishActivity(orgId: string, cardId: string, entry: ActivityEntryDocument | null) {
  if (!entry) return
  const [dto] = await toActivityDTOs([entry])
  emitToOrg(orgId, CARD_ACTIVITY, { cardId, entry: dto })
}
