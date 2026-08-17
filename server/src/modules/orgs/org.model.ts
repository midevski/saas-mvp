import { Schema, model, Types } from 'mongoose'

export interface OrgDocument {
  name: string
  slug: string
  ownerId: Types.ObjectId
  createdAt: Date
}

const orgSchema = new Schema<OrgDocument>({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
})

export const Org = model<OrgDocument>('Org', orgSchema)
