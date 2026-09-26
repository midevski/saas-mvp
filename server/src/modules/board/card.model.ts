import { Schema, model, Types } from 'mongoose'

export interface AttachmentDocument {
  _id: Types.ObjectId
  url: string
  publicId: string // storage handle used to delete the file (local filename or Cloudinary id)
  filename: string // original name, for display only
  uploadedBy: Types.ObjectId
  uploadedAt: Date
}

export interface CardDocument {
  boardId: Types.ObjectId
  columnId: Types.ObjectId
  title: string
  description: string | null
  order: number
  createdBy: Types.ObjectId
  attachments: Types.DocumentArray<AttachmentDocument>
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
  },
  { timestamps: true },
)

cardSchema.index({ columnId: 1, order: 1 })

export const Card = model<CardDocument>('Card', cardSchema)
