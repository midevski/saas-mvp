import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../../lib/errors'
import { paramAsString } from '../../lib/params'
import * as notificationService from './notification.service'

// User-scoped, not org-scoped: every route only ever touches the authenticated user's own
// notifications (the user id always comes from the token)

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(notificationService.MAX_PAGE_SIZE).optional(),
  before: z.string().regex(/^[a-f\d]{24}$/i).optional(),
})

export async function listHandler(req: Request, res: Response) {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new ValidationError('Invalid pagination parameters')
  res.json(await notificationService.getNotificationsForUser(req.user!.userId, parsed.data))
}

export async function unreadCountHandler(req: Request, res: Response) {
  res.json({ count: await notificationService.getUnreadCount(req.user!.userId) })
}

export async function markReadHandler(req: Request, res: Response) {
  const id = paramAsString(req.params.id)
  if (!id || !mongoose.isValidObjectId(id)) throw new NotFoundError('Notification not found')
  await notificationService.markAsRead(req.user!.userId, id)
  res.json({ count: await notificationService.getUnreadCount(req.user!.userId) })
}

export async function markAllReadHandler(req: Request, res: Response) {
  await notificationService.markAllAsRead(req.user!.userId)
  res.json({ count: 0 })
}
