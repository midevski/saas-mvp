import { Schema, model, Types } from 'mongoose'

export interface RefreshTokenDocument {
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  createdAt: Date
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
})

// TTL index: Mongo auto-deletes the document once expiresAt passes
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema)
