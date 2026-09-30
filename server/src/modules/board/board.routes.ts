import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import { requireRole } from '../../middleware/requireRole'
import { requireSubscription } from '../../middleware/requireSubscription'
import * as activityController from './activity.controller'
import * as boardController from './board.controller'
import * as checklistController from './checklist.controller'
import * as columnController from './column.controller'

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

// Columns: board management, so the same gate as every other board mutation
const columns = '/orgs/:orgId/board/columns'
boardRouter.post(columns, ...boardAccess, columnController.createColumnHandler)
boardRouter.patch(`${columns}/:columnId`, ...boardAccess, columnController.updateColumnHandler)
boardRouter.delete(`${columns}/:columnId`, ...boardAccess, columnController.deleteColumnHandler)

// Checklists: part of managing cards, so the same gate (every role can manage cards)
const checklists = '/orgs/:orgId/board/cards/:cardId/checklists'
boardRouter.post(checklists, ...boardAccess, checklistController.createChecklistHandler)
boardRouter.patch(`${checklists}/:checklistId`, ...boardAccess, checklistController.renameChecklistHandler)
boardRouter.delete(`${checklists}/:checklistId`, ...boardAccess, checklistController.deleteChecklistHandler)
boardRouter.post(`${checklists}/:checklistId/items`, ...boardAccess, checklistController.addItemHandler)
boardRouter.patch(`${checklists}/:checklistId/items/:itemId`, ...boardAccess, checklistController.updateItemHandler)
boardRouter.delete(`${checklists}/:checklistId/items/:itemId`, ...boardAccess, checklistController.deleteItemHandler)

// Activity feed: comments are a card mutation like any other, so the same gate. Deleting a
// comment additionally needs its author or an owner/admin (checked in the service). No editing.
const activity = '/orgs/:orgId/board/cards/:cardId'
boardRouter.get(`${activity}/activity`, ...boardAccess, activityController.listActivityHandler)
boardRouter.post(`${activity}/comments`, ...boardAccess, activityController.addCommentHandler)
boardRouter.delete(`${activity}/comments/:activityId`, ...boardAccess, activityController.deleteCommentHandler)
