import { Schema, model, Types } from 'mongoose'

export interface ColumnDocument {
  boardId: Types.ObjectId
  name: string
  order: number
}

const columnSchema = new Schema<ColumnDocument>({
  boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
  name: { type: String, required: true, trim: true },
  // Left-to-right position on the board
  order: { type: Number, required: true },
})

export const Column = model<ColumnDocument>('Column', columnSchema)
