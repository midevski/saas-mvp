import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../../lib/errors'
import { paramAsString } from '../../lib/params'
import { CARD_UPDATED } from '../../realtime/events'
import { emitToOrg, requesterSocketId } from '../../realtime/emitter'
import { publishActivity } from './activity.service'
import type { CardDTO } from './board.service'
import { cardInOrg } from './board.controller'
import * as checklistService from './checklist.service'

const checklistTitle = z.string().trim().min(1).max(100)
const itemText = z.string().trim().min(1).max(500)

const createChecklistSchema = z.object({ title: checklistTitle.optional() })
const renameChecklistSchema = z.object({ title: checklistTitle })
const addItemSchema = z.object({ text: itemText })
const updateItemSchema = z
  .object({ text: itemText.optional(), completed: z.boolean().optional() })
  .refine((d) => d.text !== undefined || d.completed !== undefined, 'Nothing to update')

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid request body')
  return parsed.data
}

function objectIdParam(req: Request, name: string, label: string) {
  const value = paramAsString(req.params[name])
  if (!value || !mongoose.isValidObjectId(value)) throw new NotFoundError(`${label} not found`)
  return value
}

// A checklist change is a card update: everyone on the board gets it live, except the browser
// that made the change (it applies the HTTP response instead)
function broadcast(req: Request, res: Response, orgId: string, card: CardDTO, status = 200) {
  emitToOrg(orgId, CARD_UPDATED, { card }, requesterSocketId(req.get('x-socket-id')))
  res.status(status).json({ card })
}

export async function createChecklistHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const { title } = parse(createChecklistSchema, req.body ?? {})
  const card = await checklistService.addChecklist(cardId, title ?? 'Checklist')
  broadcast(req, res, orgId, card, 201)
}

export async function renameChecklistHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const checklistId = objectIdParam(req, 'checklistId', 'Checklist')
  const { title } = parse(renameChecklistSchema, req.body)
  broadcast(req, res, orgId, await checklistService.renameChecklist(cardId, checklistId, title))
}

export async function deleteChecklistHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const checklistId = objectIdParam(req, 'checklistId', 'Checklist')
  broadcast(req, res, orgId, await checklistService.deleteChecklist(cardId, checklistId))
}

export async function addItemHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const checklistId = objectIdParam(req, 'checklistId', 'Checklist')
  const { text } = parse(addItemSchema, req.body)
  broadcast(req, res, orgId, await checklistService.addItem(cardId, checklistId, text), 201)
}

export async function updateItemHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const checklistId = objectIdParam(req, 'checklistId', 'Checklist')
  const itemId = objectIdParam(req, 'itemId', 'Checklist item')
  const changes = parse(updateItemSchema, req.body)
  // The user who toggled comes from the auth token — never from the request body
  const { card, activity } = await checklistService.updateItem(cardId, checklistId, itemId, changes, req.user!.userId)
  await publishActivity(orgId, cardId, activity)
  broadcast(req, res, orgId, card)
}

export async function deleteItemHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const checklistId = objectIdParam(req, 'checklistId', 'Checklist')
  const itemId = objectIdParam(req, 'itemId', 'Checklist item')
  broadcast(req, res, orgId, await checklistService.deleteItem(cardId, checklistId, itemId))
}
