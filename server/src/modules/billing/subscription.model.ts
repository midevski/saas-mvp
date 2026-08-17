import { Schema, model, Types } from 'mongoose'
import type Stripe from 'stripe'

export type SubscriptionStatus = Stripe.Subscription.Status

export interface SubscriptionDocument {
  orgId: Types.ObjectId
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  status: SubscriptionStatus
  priceId: string | null
  currentPeriodEnd: Date | null
  updatedAt: Date
}

const subscriptionSchema = new Schema<SubscriptionDocument>({
  // One subscription per org for this project's scope
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true, unique: true },
  stripeCustomerId: { type: String, required: true },
  stripeSubscriptionId: { type: String, default: null },
  status: { type: String, required: true, default: 'incomplete' },
  priceId: { type: String, default: null },
  currentPeriodEnd: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
})

export const Subscription = model<SubscriptionDocument>('Subscription', subscriptionSchema)
