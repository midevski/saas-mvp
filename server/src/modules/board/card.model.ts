import { Schema, model, Types } from 'mongoose'

export interface CardDocument {
  boardId: Types.ObjectId
  columnId: Types.ObjectId
  title: string
  description: string | null
  order: number
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const cardSchema = new Schema<CardDocument>(
  {
    boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    columnId: { type: Schema.Types.ObjectId, ref: 'Column', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    // Position within its column — relative only (see board.service moveCard)
    order: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
)

cardSchema.index({ columnId: 1, order: 1 })

export const Card = model<CardDocument>('Card', cardSchema)
