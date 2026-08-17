import type { NextFunction, Request, Response } from 'express'
import { paramAsString } from '../lib/params'
import { isOrgSubscribed } from '../modules/billing/billing.service'

// Requires requireRole (or at least requireAuth) to have run first
export async function requireSubscription(req: Request, res: Response, next: NextFunction) {
  const orgId = paramAsString(req.params.orgId)
  if (!orgId) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  const subscribed = await isOrgSubscribed(orgId)
  if (!subscribed) {
    res.status(402).json({ error: 'This feature requires an active subscription' })
    return
  }

  next()
}
