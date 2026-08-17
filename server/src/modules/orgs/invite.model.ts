import { Schema, model, Types } from 'mongoose'

export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type InviteRole = 'admin' | 'member'

export interface InviteDocument {
  orgId: Types.ObjectId
  email: string
  role: InviteRole
  token: string
  expiresAt: Date
  status: InviteStatus
  invitedBy: Types.ObjectId
  createdAt: Date
}

const inviteSchema = new Schema<InviteDocument>({
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'member'], required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending' },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
})

export const Invite = model<InviteDocument>('Invite', inviteSchema)
