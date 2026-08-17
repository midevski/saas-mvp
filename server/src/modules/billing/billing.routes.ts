import express, { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import { requireRole } from '../../middleware/requireRole'
import { requireSubscription } from '../../middleware/requireSubscription'
import * as billingController from './billing.controller'

export const billingRouter = Router()

billingRouter.get('/billing/config', requireAuth, billingController.configHandler)

billingRouter.post(
  '/orgs/:orgId/billing/checkout',
  requireAuth,
  requireRole(['owner']),
  billingController.checkoutHandler,
)

billingRouter.post(
  '/orgs/:orgId/billing/portal',
  requireAuth,
  requireRole(['owner']),
  billingController.portalHandler,
)

billingRouter.get(
  '/orgs/:orgId/billing/status',
  requireAuth,
  requireRole(['owner', 'admin', 'member']),
  billingController.statusHandler,
)

// Proves requireSubscription works; Phase 4 mounts it on the real gated feature route
billingRouter.get(
  '/orgs/:orgId/premium-placeholder',
  requireAuth,
  requireRole(['owner', 'admin', 'member']),
  requireSubscription,
  billingController.premiumPlaceholderHandler,
)

// Stripe calls this directly and authenticates via signature verification, not requireAuth.
// Mounted separately in app.ts, before the global express.json() — signature verification
// needs the exact raw request bytes, which a JSON-parsed body can't reproduce.
export const billingWebhookRouter = Router()

billingWebhookRouter.post(
  '/billing/webhook',
  express.raw({ type: 'application/json' }),
  billingController.webhookHandler,
)
