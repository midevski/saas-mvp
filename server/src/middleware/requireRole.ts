import type { NextFunction, Request, Response } from 'express'
import { paramAsString } from '../lib/params'
import type { MembershipRole } from '../modules/orgs/membership.model'
import { findMembership } from '../modules/orgs/org.service'

declare global {
  namespace Express {
    interface Request {
      membership?: { orgId: string; role: MembershipRole }
    }
  }
}

// Requires requireAuth to have run first (needs req.user)
export function requireRole(allowedRoles: MembershipRole[]) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const orgId = paramAsString(req.params.orgId)
    if (!orgId || !req.user) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // Malformed orgId (e.g. bad ObjectId) comes back null — treated like "no such org"
    const membership = await findMembership(orgId, req.user.userId)
    if (!membership) {
      // Don't leak org existence to non-members: 404, not 403
      res.status(404).json({ error: 'Not found' })
      return
    }

    if (!allowedRoles.includes(membership.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }

    req.membership = { orgId, role: membership.role }
    next()
  }
}
