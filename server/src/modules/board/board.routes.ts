import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import { requireRole } from '../../middleware/requireRole'
import { requireSubscription } from '../../middleware/requireSubscription'
import * as boardController from './board.controller'

export const boardRouter = Router()

// "Pro plan required for the collaborative board"
boardRouter.get(
  '/orgs/:orgId/board',
  requireAuth,
  requireRole(['owner', 'admin', 'member']),
  requireSubscription,
  boardController.getBoardHandler,
)
