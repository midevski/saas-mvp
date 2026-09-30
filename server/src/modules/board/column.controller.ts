import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../../lib/errors'
import { paramAsString } from '../../lib/params'
import { COLUMN_CREATED, COLUMN_DELETED, COLUMN_UPDATED } from '../../realtime/events'
import { emitToOrg, requesterSocketId } from '../../realtime/emitter'
import * as boardService from './board.service'
import * as columnService from './column.service'

// REST equivalents of the column socket events (the board UI uses the socket; both paths share
// the same service code and broadcast the same events)

const objectId = z.string().regex(/^[a-f\d]{24}$/i)
const columnName = z.string().trim().min(1).max(60)
const createSchema = z.object({ name: columnName })
// Rename only: order and collapse are each viewer's own layout, kept in their browser
const updateSchema = z.object({ name: columnName }).strict()
const deleteSchema = z.object({ moveCardsTo: objectId.optional() })

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {})
  if (parsed.success) return parsed.data
  const layoutField = ['collapsed', 'order'].find((f) => body && typeof body === 'object' && f in body)
  if (layoutField) {
    throw new ValidationError(`"${layoutField}" is a per-browser layout setting and is never stored on the server`)
  }
  throw new ValidationError('Invalid request body')
}

// The column must belong to the org in the URL (whose membership/subscription the route checked)
async function columnInOrg(req: Request) {
  const orgId = paramAsString(req.params.orgId)!
  const columnId = paramAsString(req.params.columnId)
  if (!columnId || !mongoose.isValidObjectId(columnId)) throw new NotFoundError('Column not found')
  if ((await columnService.getOrgIdForColumn(columnId)) !== orgId) throw new NotFoundError('Column not found')
  return { orgId, columnId }
}

function broadcast(req: Request, orgId: string, event: string, payload: unknown) {
  emitToOrg(orgId, event, payload, requesterSocketId(req.get('x-socket-id')))
}

export async function createColumnHandler(req: Request, res: Response) {
  const orgId = paramAsString(req.params.orgId)!
  const { name } = parse(createSchema, req.body)
  const board = await boardService.getOrCreateBoardForOrg(orgId)
  const column = await columnService.createColumn(board._id.toString(), name)
  broadcast(req, orgId, COLUMN_CREATED, { column })
  res.status(201).json({ column })
}

export async function updateColumnHandler(req: Request, res: Response) {
  const { orgId, columnId } = await columnInOrg(req)
  const { name } = parse(updateSchema, req.body)
  const column = await columnService.renameColumn(columnId, name)
  broadcast(req, orgId, COLUMN_UPDATED, { column })
  res.json({ column })
}

export async function deleteColumnHandler(req: Request, res: Response) {
  const { orgId, columnId } = await columnInOrg(req)
  const { moveCardsTo } = parse(deleteSchema, req.body)
  const result = await columnService.deleteColumn(columnId, moveCardsTo)
  broadcast(req, orgId, COLUMN_DELETED, result)
  res.json(result)
}
