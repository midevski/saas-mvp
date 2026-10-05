import { Schema, model, Types } from 'mongoose'

// Extensible on purpose: new kinds (assigned to a card, invited to an org...) are just new values
export const NOTIFICATION_TYPES = ['mention'] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// Its own collection, not embedded on the card: notifications belong to the recipient, are read
// across every org/card they touch, and outlive the comment that caused them.
export interface NotificationDocument {
  recipientId: Types.ObjectId
  type: NotificationType
  actorId: Types.ObjectId // who triggered it (e.g. the commenter)
  orgId: Types.ObjectId
  cardId: Types.ObjectId
  activityId: Types.ObjectId // the comment entry in the card's activity feed
  // Precomputed at creation, e.g. `Sarah mentioned you on "Launch": "can you check..."` — the
  // comment (or card) may be deleted later, and the list shouldn't have to re-derive it
  text: string
  read: boolean
  createdAt: Date
}

const notificationSchema = new Schema<NotificationDocument>({
  recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: NOTIFICATION_TYPES, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
  activityId: { type: Schema.Types.ObjectId, required: true },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
})

// The bell's list (newest first, paginated) and its unread count
notificationSchema.index({ recipientId: 1, createdAt: -1, _id: -1 })
notificationSchema.index({ recipientId: 1, read: 1 })

export const Notification = model<NotificationDocument>('Notification', notificationSchema)
