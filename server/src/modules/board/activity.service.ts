import { Types } from 'mongoose'
import { ForbiddenError, NotFoundError } from '../../lib/errors'
import { CARD_ACTIVITY, CARD_ACTIVITY_DELETED } from '../../realtime/events'
import { Membership, type MembershipRole } from '../orgs/membership.model'
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

// Mentions arrive as explicit user ids from the client's mention picker — never guessed from the
// text. They're only trusted as far as this: every id must be a current member of the org.
// Anything else (a spoofed id, someone who left) is dropped, so nobody outside the org can ever
// be "mentioned" (and, from Phase 14, notified).
export async function keepOrgMembers(orgId: string, userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return []
  const members = await Membership.find({ orgId, userId: { $in: unique } }).select('userId')
  const memberIds = new Set(members.map((m) => m.userId.toString()))
  return unique.filter((id) => memberIds.has(id)) // keeps the order they were picked in
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

// No editing (delete and repost instead)
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

// Comments can be deleted by their author, or by an owner/admin (moderation). System entries
// can't be deleted at all: they're the record of what happened, not anyone's own words.
// Hard delete — the entry is removed from the feed outright.
export async function deleteComment(
  cardId: string,
  activityId: string,
  userId: string,
  role: MembershipRole,
): Promise<void> {
  const card = await Card.findOne({ _id: cardId, 'activity._id': activityId }, { 'activity.$': 1 })
  const entry = card?.activity?.[0]
  if (!entry) {
    if (!(await Card.exists({ _id: cardId }))) throw new NotFoundError('Card not found')
    throw new NotFoundError('Comment not found')
  }
  if (entry.type !== 'comment') throw new ForbiddenError("Activity entries can't be deleted — only comments can")
  const isAuthor = entry.authorId?.toString() === userId
  if (!isAuthor && role !== 'owner' && role !== 'admin') {
    throw new ForbiddenError('Only the author, an admin or the owner can delete this comment')
  }
  // The type filter makes the "comments only" rule hold at the write itself, too
  const result = await Card.updateOne(
    { _id: cardId },
    { $pull: { activity: { _id: new Types.ObjectId(activityId), type: 'comment' } } },
  )
  if (result.modifiedCount === 0) throw new NotFoundError('Comment not found') // deleted meanwhile
}

export function publishActivityDeleted(orgId: string, cardId: string, activityId: string) {
  emitToOrg(orgId, CARD_ACTIVITY_DELETED, { cardId, activityId })
}

// Tells everyone on the board — including whoever triggered it; clients de-duplicate by id.
// A lighter event than card:updated: open feeds append the one entry.
export async function publishActivity(orgId: string, cardId: string, entry: ActivityEntryDocument | null) {
  if (!entry) return
  const [dto] = await toActivityDTOs([entry])
  emitToOrg(orgId, CARD_ACTIVITY, { cardId, entry: dto })
}
