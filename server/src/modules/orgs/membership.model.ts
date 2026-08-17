import { Schema, model, Types } from 'mongoose'

export type MembershipRole = 'owner' | 'admin' | 'member'

export interface MembershipDocument {
  orgId: Types.ObjectId
  userId: Types.ObjectId
  role: MembershipRole
  createdAt: Date
}

const membershipSchema = new Schema<MembershipDocument>({
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  createdAt: { type: Date, default: Date.now },
})

// A user can't have two memberships in the same org
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true })

export const Membership = model<MembershipDocument>('Membership', membershipSchema)
