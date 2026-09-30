import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import { requireRole } from '../../middleware/requireRole'
import * as orgController from './org.controller'

export const orgRouter = Router()

orgRouter.post('/orgs', requireAuth, orgController.createOrgHandler)
orgRouter.get('/orgs', requireAuth, orgController.listOrgsHandler)

orgRouter.get(
  '/orgs/:orgId/members',
  requireAuth,
  requireRole(['owner', 'admin', 'member']),
  orgController.getMembersHandler,
)

orgRouter.post(
  '/orgs/:orgId/invites',
  requireAuth,
  requireRole(['owner', 'admin']),
  orgController.inviteHandler,
)

orgRouter.get(
  '/orgs/:orgId/invites',
  requireAuth,
  requireRole(['owner', 'admin']),
  orgController.listInvitesHandler,
)

orgRouter.delete(
  '/orgs/:orgId/invites/:inviteId',
  requireAuth,
  requireRole(['owner', 'admin']),
  orgController.revokeInviteHandler,
)

orgRouter.post('/invites/:token/accept', requireAuth, orgController.acceptInviteHandler)

orgRouter.delete(
  '/orgs/:orgId/members/:userId',
  requireAuth,
  requireRole(['owner', 'admin']),
  orgController.removeMemberHandler,
)

// Owner only — the most destructive action in the app. Deliberately *not* behind
// requireSubscription: an org must be deletable whether or not it's paying.
orgRouter.delete('/orgs/:orgId', requireAuth, requireRole(['owner']), orgController.deleteOrgHandler)

orgRouter.patch(
  '/orgs/:orgId/members/:userId',
  requireAuth,
  requireRole(['owner']),
  orgController.updateRoleHandler,
)
