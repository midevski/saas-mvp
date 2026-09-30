import type { Request, Response } from 'express'
import { z } from 'zod'
import { ValidationError } from '../../lib/errors'
import { getMembers } from '../orgs/org.service'
import * as activityService from './activity.service'
import { cardInOrg } from './board.controller'

const commentSchema = z.object({ text: z.string().trim().min(1).max(2000) })

// The card's whole feed, oldest first — fetched when its detail view opens
export async function listActivityHandler(req: Request, res: Response) {
  const { cardId } = await cardInOrg(req)
  res.json({ entries: await activityService.listActivity(cardId) })
}

export async function addCommentHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) throw new ValidationError('A comment needs 1 to 2000 characters of text')
  const { text } = parsed.data

  // @mentions only count for people currently in this org
  const members = await getMembers(orgId)
  const mentions = activityService
    .findMentions(
      text,
      members.flatMap((m) => (m.name ? [{ id: m.userId, name: m.name }] : [])),
    )
    .map((m) => m.id)

  // The author is always the authenticated user, never something from the body
  const entry = await activityService.addComment(cardId, req.user!.userId, text, mentions)
  // Everyone on the board (the poster's other tabs included); the poster's tab also applies the
  // response below and de-duplicates by id
  await activityService.publishActivity(orgId, cardId, entry)
  const [dto] = await activityService.toActivityDTOs([entry])
  res.status(201).json({ entry: dto })
}
