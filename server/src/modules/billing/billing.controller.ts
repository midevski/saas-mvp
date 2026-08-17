import type { Request, Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env'
import { paramAsString } from '../../lib/params'
import * as billingService from './billing.service'

const checkoutSchema = z.object({ priceId: z.string().min(1) })

export function configHandler(_req: Request, res: Response) {
  // Price IDs aren't secret (unlike the Stripe secret/webhook keys) — safe to expose
  res.json({ proPriceId: env.STRIPE_PRICE_ID_PRO })
}

export async function checkoutHandler(req: Request, res: Response) {
  const parsed = checkoutSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const url = await billingService.createCheckoutSession(
    paramAsString(req.params.orgId)!,
    req.user!.userId,
    parsed.data.priceId,
  )
  res.json({ url })
}

export async function portalHandler(req: Request, res: Response) {
  const url = await billingService.createBillingPortalSession(paramAsString(req.params.orgId)!)
  res.json({ url })
}

export async function statusHandler(req: Request, res: Response) {
  const orgId = paramAsString(req.params.orgId)!
  const [subscription, subscribed] = await Promise.all([
    billingService.getSubscriptionForOrg(orgId),
    billingService.isOrgSubscribed(orgId),
  ])

  res.json({
    subscribed,
    status: subscription?.status ?? null,
    priceId: subscription?.priceId ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  })
}

export function premiumPlaceholderHandler(_req: Request, res: Response) {
  res.json({ message: 'This is a placeholder for a subscription-gated feature.' })
}

export async function webhookHandler(req: Request, res: Response) {
  const signature = req.headers['stripe-signature']
  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing signature' })
    return
  }

  let event
  try {
    event = billingService.verifyWebhookSignature(req.body as Buffer, signature)
  } catch {
    res.status(400).json({ error: 'Invalid signature' })
    return
  }

  await billingService.handleWebhookEvent(event)
  res.json({ received: true })
}
