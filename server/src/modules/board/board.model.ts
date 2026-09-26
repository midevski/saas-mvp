import { Schema, model, Types } from 'mongoose'

export interface BoardDocument {
  orgId: Types.ObjectId
  name: string
  createdAt: Date
}

const boardSchema = new Schema<BoardDocument>({
  // One board per org for this project's scope
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true, unique: true },
  name: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
})

export const Board = model<BoardDocument>('Board', boardSchema)
