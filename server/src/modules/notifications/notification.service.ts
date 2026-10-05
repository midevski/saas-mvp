import { Types } from 'mongoose'
import { NotFoundError } from '../../lib/errors'
import { NOTIFICATION_NEW, NOTIFICATION_READ } from '../../realtime/events'
import { emitToUsers } from '../../realtime/emitter'
import { Card } from '../board/card.model'
import { Membership } from '../orgs/membership.model'
import { User } from '../users/user.model'
import { Notification, type NotificationDocument, type NotificationType } from './notification.model'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

export interface NotificationDTO {
  id: string
  type: NotificationType
  actor: { id: string; name: string }
  orgId: string
  cardId: string
  activityId: string
  text: string
  read: boolean
  createdAt: Date
}

type WithId<T> = T & { _id: Types.ObjectId }

async function toDTOs(docs: WithId<NotificationDocument>[]): Promise<NotificationDTO[]> {
  const actors = await User.find({ _id: { $in: [...new Set(docs.map((d) => d.actorId.toString()))] } }).select('name')
  const nameById = new Map(actors.map((u) => [u.id as string, u.name]))
  return docs.map((d) => ({
    id: d._id.toString(),
    type: d.type,
    actor: { id: d.actorId.toString(), name: nameById.get(d.actorId.toString()) ?? 'Former user' },
    orgId: d.orgId.toString(),
    cardId: d.cardId.toString(),
    activityId: d.activityId.toString(),
    text: d.text,
    read: d.read,
    createdAt: d.createdAt,
  }))
}

function clip(text: string, max: number) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

// One notification per mentioned person — never the commenter themself — each pushed live to
// that person's own socket room, wherever they are in the app. Callers treat this as best-effort
// (see notifyMentionsSafely): a notification problem must never fail the comment.
export async function createMentionNotifications(params: {
  orgId: string
  cardId: string
  activityId: string
  actorId: string
  mentionedUserIds: string[]
  commentText: string
}): Promise<NotificationDTO[]> {
  const recipients = [...new Set(params.mentionedUserIds)].filter((id) => id !== params.actorId)
  if (recipients.length === 0) return []

  const [actor, card] = await Promise.all([
    User.findById(params.actorId).select('name'),
    Card.findById(params.cardId).select('title'),
  ])
  const text = `${actor?.name ?? 'Someone'} mentioned you on "${clip(card?.title ?? 'a card', 60)}": "${clip(params.commentText, 100)}"`

  const created = await Notification.insertMany(
    recipients.map((recipientId) => ({
      recipientId: new Types.ObjectId(recipientId),
      type: 'mention' as const,
      actorId: new Types.ObjectId(params.actorId),
      orgId: new Types.ObjectId(params.orgId),
      cardId: new Types.ObjectId(params.cardId),
      activityId: new Types.ObjectId(params.activityId),
      text,
    })),
  )
  const dtos = await toDTOs(created)
  created.forEach((doc, i) => emitToUsers([doc.recipientId.toString()], NOTIFICATION_NEW, { notification: dtos[i] }))
  return dtos
}

// Logs instead of throwing — same rule as the welcome-email job: the parent action (posting the
// comment) has already succeeded and must stay that way
export async function notifyMentionsSafely(params: Parameters<typeof createMentionNotifications>[0]) {
  try {
    await createMentionNotifications(params)
  } catch (err) {
    console.error(`[notifications] could not create mention notifications: ${(err as Error).message}`)
  }
}

// Only notifications from orgs the user still belongs to: after leaving (or being removed from)
// an org, its notifications would just be dead links into a board they can't open
async function visibleTo(userId: string) {
  const memberships = await Membership.find({ userId }).select('orgId')
  return { recipientId: new Types.ObjectId(userId), orgId: { $in: memberships.map((m) => m.orgId) } }
}

// Newest first. `before` is the id of the last notification already shown (cursor pagination,
// stable while new notifications keep arriving at the top).
export async function getNotificationsForUser(
  userId: string,
  { limit = DEFAULT_PAGE_SIZE, before }: { limit?: number | undefined; before?: string | undefined } = {},
): Promise<{ notifications: NotificationDTO[]; nextCursor: string | null }> {
  const filter: Record<string, unknown> = await visibleTo(userId)
  if (before) {
    const cursor = await Notification.findOne({ _id: before, recipientId: userId }).select('createdAt')
    if (!cursor) throw new NotFoundError('Notification not found')
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ]
  }
  const docs = await Notification.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
  const page = docs.slice(0, limit)
  return {
    notifications: await toDTOs(page),
    nextCursor: docs.length > limit ? page[page.length - 1]!._id.toString() : null,
  }
}

export async function getUnreadCount(userId: string): Promise<number> {
  return Notification.countDocuments({ ...(await visibleTo(userId)), read: false })
}

// Ownership is part of the filter: someone else's notification id simply isn't found (404, so
// a guessed id doesn't even reveal that it exists)
export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  const result = await Notification.updateOne({ _id: notificationId, recipientId: userId }, { $set: { read: true } })
  if (result.matchedCount === 0) throw new NotFoundError('Notification not found')
  // The user's other tabs update their bell too
  emitToUsers([userId], NOTIFICATION_READ, { notificationIds: [notificationId] })
}

export async function markAllAsRead(userId: string): Promise<void> {
  await Notification.updateMany({ recipientId: userId, read: false }, { $set: { read: true } })
  emitToUsers([userId], NOTIFICATION_READ, { all: true })
}

// When an org is deleted, its notifications go with it
export async function deleteNotificationsForOrg(orgId: string): Promise<void> {
  await Notification.deleteMany({ orgId })
}
