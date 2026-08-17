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

orgRouter.post('/invites/:token/accept', requireAuth, orgController.acceptInviteHandler)

orgRouter.delete(
  '/orgs/:orgId/members/:userId',
  requireAuth,
  requireRole(['owner', 'admin']),
  orgController.removeMemberHandler,
)

orgRouter.patch(
  '/orgs/:orgId/members/:userId',
  requireAuth,
  requireRole(['owner']),
  orgController.updateRoleHandler,
)
