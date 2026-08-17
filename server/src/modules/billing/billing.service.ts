import type Stripe from 'stripe'
import { stripe } from '../../config/stripe'
import { env } from '../../config/env'
import { NotFoundError } from '../../lib/errors'
import { Org } from '../orgs/org.model'
import { Subscription, type SubscriptionStatus } from './subscription.model'

const ACTIVE_STATUSES: SubscriptionStatus[] = ['active', 'trialing']

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null
}

function firstPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items.data[0]?.price.id ?? null
}

async function getOrCreateCustomerId(orgId: string): Promise<string> {
  const existing = await Subscription.findOne({ orgId })
  if (existing) return existing.stripeCustomerId

  const org = await Org.findById(orgId)
  if (!org) throw new NotFoundError('Org not found')

  const customer = await stripe.customers.create({
    name: org.name,
    metadata: { orgId: org.id },
  })

  await Subscription.create({
    orgId,
    stripeCustomerId: customer.id,
    status: 'incomplete',
  })

  return customer.id
}

export async function createCheckoutSession(orgId: string, userId: string, priceId: string) {
  const customerId = await getOrCreateCustomerId(orgId)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.CLIENT_URL}/orgs/${orgId}/billing?checkout=success`,
    cancel_url: `${env.CLIENT_URL}/orgs/${orgId}/billing?checkout=cancel`,
    metadata: { orgId, userId },
  })

  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  return session.url
}

export async function createBillingPortalSession(orgId: string) {
  const subscription = await Subscription.findOne({ orgId })
  if (!subscription) throw new NotFoundError('No billing account for this org yet')

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${env.CLIENT_URL}/orgs/${orgId}/billing`,
  })

  return portalSession.url
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
  // Critical: never trust an unverified webhook payload
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
}

async function syncFromStripeSubscription(stripeSubscription: Stripe.Subscription) {
  await Subscription.findOneAndUpdate(
    { stripeCustomerId: stripeSubscription.customer as string },
    {
      stripeSubscriptionId: stripeSubscription.id,
      status: stripeSubscription.status,
      priceId: firstPriceId(stripeSubscription),
      currentPeriodEnd: toDate(stripeSubscription.items.data[0]?.current_period_end),
      updatedAt: new Date(),
    },
  )
}

export async function handleWebhookEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const orgId = session.metadata?.orgId
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : null
      if (!orgId || typeof session.customer !== 'string' || !subscriptionId) break

      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId)

      await Subscription.findOneAndUpdate(
        { orgId },
        {
          stripeCustomerId: session.customer,
          stripeSubscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          priceId: firstPriceId(stripeSubscription),
          currentPeriodEnd: toDate(stripeSubscription.items.data[0]?.current_period_end),
          updatedAt: new Date(),
        },
        { upsert: true },
      )
      break
    }

    case 'customer.subscription.updated': {
      await syncFromStripeSubscription(event.data.object as Stripe.Subscription)
      break
    }

    case 'customer.subscription.deleted': {
      const stripeSubscription = event.data.object as Stripe.Subscription
      await Subscription.findOneAndUpdate(
        { stripeCustomerId: stripeSubscription.customer as string },
        { status: 'canceled', updatedAt: new Date() },
      )
      break
    }

    default:
      // Other Stripe event types are intentionally ignored (Future work if needed)
      break
  }
}

export async function getSubscriptionForOrg(orgId: string) {
  return Subscription.findOne({ orgId })
}

export async function isOrgSubscribed(orgId: string): Promise<boolean> {
  const subscription = await Subscription.findOne({ orgId })
  if (!subscription) return false
  return ACTIVE_STATUSES.includes(subscription.status)
}
