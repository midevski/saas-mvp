import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import { requireRole } from '../../middleware/requireRole'
import { requireSubscription } from '../../middleware/requireSubscription'
import * as boardController from './board.controller'

export const boardRouter = Router()

// Same gate for everything board-related: any org member, org must be subscribed.
// "Pro plan required for the collaborative board"
const boardAccess = [requireAuth, requireRole(['owner', 'admin', 'member']), requireSubscription]

boardRouter.get('/orgs/:orgId/board', ...boardAccess, boardController.getBoardHandler)

// Permission checks run before multer, so uploads from people who aren't allowed are never read
boardRouter.post(
  '/orgs/:orgId/board/cards/:cardId/attachments',
  ...boardAccess,
  boardController.receiveImage,
  boardController.uploadAttachmentHandler,
)

boardRouter.delete(
  '/orgs/:orgId/board/cards/:cardId/attachments/:attachmentId',
  ...boardAccess,
  boardController.deleteAttachmentHandler,
)
