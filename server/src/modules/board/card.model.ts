import { Schema, model, Types } from 'mongoose'

export interface AttachmentDocument {
  _id: Types.ObjectId
  url: string
  publicId: string // storage handle used to delete the file (local filename or Cloudinary id)
  filename: string // original name, for display only
  uploadedBy: Types.ObjectId
  uploadedAt: Date
}

export interface ChecklistItemDocument {
  _id: Types.ObjectId
  text: string
  completed: boolean
  completedBy: Types.ObjectId | null // set server-side from the authenticated user
  completedAt: Date | null
}

export interface ChecklistDocument {
  _id: Types.ObjectId
  title: string
  items: Types.DocumentArray<ChecklistItemDocument>
}

export type ActivityType = 'comment' | 'system'

// One entry in a card's feed: something someone said (comment) or did (system, e.g. a move).
// Append-only — entries are never edited or removed.
export interface ActivityEntryDocument {
  _id: Types.ObjectId
  type: ActivityType
  // Who said/did it. Every entry has one today; null is reserved for future automated entries
  // with no human behind them.
  authorId: Types.ObjectId | null
  text: string // the comment body, or the system message ("moved this card from To Do to Done")
  mentions: Types.ObjectId[] // users @mentioned in a comment (always empty for system entries)
  createdAt: Date
}

export interface CardDocument {
  boardId: Types.ObjectId
  columnId: Types.ObjectId
  title: string
  description: string | null
  order: number
  createdBy: Types.ObjectId
  attachments: Types.DocumentArray<AttachmentDocument>
  checklists: Types.DocumentArray<ChecklistDocument>
  activity: Types.DocumentArray<ActivityEntryDocument>
  createdAt: Date
  updatedAt: Date
}

// Embedded, not a collection: attachments are only ever read in the context of their card
const attachmentSchema = new Schema<AttachmentDocument>({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  filename: { type: String, required: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now },
})

// Embedded for the same reason: a checklist only exists in the context of its card
const checklistItemSchema = new Schema<ChecklistItemDocument>({
  text: { type: String, required: true, trim: true },
  completed: { type: Boolean, default: false },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null },
})

const checklistSchema = new Schema<ChecklistDocument>({
  title: { type: String, required: true, trim: true, default: 'Checklist' },
  items: { type: [checklistItemSchema], default: [] },
})

// Embedded like the rest. Excluded from queries by default (select: false): the feed only grows,
// and it's only needed while a card's detail view is open — board loads and card broadcasts
// never carry it. Read it with .select('+activity').
const activityEntrySchema = new Schema<ActivityEntryDocument>({
  type: { type: String, enum: ['comment', 'system'], required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  text: { type: String, required: true },
  mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  createdAt: { type: Date, default: Date.now },
})

const cardSchema = new Schema<CardDocument>(
  {
    boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    columnId: { type: Schema.Types.ObjectId, ref: 'Column', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    // Position within its column — relative only (see board.service moveCard)
    order: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    attachments: { type: [attachmentSchema], default: [] },
    checklists: { type: [checklistSchema], default: [] },
    activity: { type: [activityEntrySchema], default: [], select: false },
  },
  { timestamps: true },
)

cardSchema.index({ columnId: 1, order: 1 })

export const Card = model<CardDocument>('Card', cardSchema)
