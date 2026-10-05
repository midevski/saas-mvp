import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import * as notificationController from './notification.controller'

export const notificationRouter = Router()

// Signed-in users only; no org/role gate — these are the caller's own notifications
notificationRouter.get('/notifications', requireAuth, notificationController.listHandler)
notificationRouter.get('/notifications/unread-count', requireAuth, notificationController.unreadCountHandler)
notificationRouter.patch('/notifications/read-all', requireAuth, notificationController.markAllReadHandler)
notificationRouter.patch('/notifications/:id/read', requireAuth, notificationController.markReadHandler)
