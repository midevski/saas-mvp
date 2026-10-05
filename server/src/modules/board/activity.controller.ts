import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../../lib/errors'
import { paramAsString } from '../../lib/params'
import { notifyMentionsSafely } from '../notifications/notification.service'
import * as activityService from './activity.service'
import { cardInOrg } from './board.controller'

const objectId = z.string().regex(/^[a-f\d]{24}$/i)
const commentSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  // Picked explicitly in the composer's mention dropdown — see keepOrgMembers
  mentionedUserIds: z.array(objectId).max(50).default([]),
})

// The card's whole feed, oldest first — fetched when its detail view opens
export async function listActivityHandler(req: Request, res: Response) {
  const { cardId } = await cardInOrg(req)
  res.json({ entries: await activityService.listActivity(cardId) })
}

export async function addCommentHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError('A comment needs 1 to 2000 characters of text')
  const { text, mentionedUserIds } = parsed.data

  const mentions = await activityService.keepOrgMembers(orgId, mentionedUserIds)
  // The author is always the authenticated user, never something from the body
  const entry = await activityService.addComment(cardId, req.user!.userId, text, mentions)
  // Everyone on the board (the poster's other tabs included); the poster's tab also applies the
  // response below and de-duplicates by id
  await activityService.publishActivity(orgId, cardId, entry)
  // Tell the people mentioned (best-effort: never fails the comment itself)
  await notifyMentionsSafely({
    orgId,
    cardId,
    activityId: entry._id.toString(),
    actorId: req.user!.userId,
    mentionedUserIds: mentions,
    commentText: text,
  })
  const [dto] = await activityService.toActivityDTOs([entry])
  res.status(201).json({ entry: dto })
}

export async function deleteCommentHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const activityId = paramAsString(req.params.activityId)
  if (!activityId || !mongoose.isValidObjectId(activityId)) throw new NotFoundError('Comment not found')

  // The role comes from requireRole's membership lookup for this org
  await activityService.deleteComment(cardId, activityId, req.user!.userId, req.membership!.role)
  activityService.publishActivityDeleted(orgId, cardId, activityId)
  res.status(204).end()
}
