import type { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../../lib/errors'
import { paramAsString } from '../../lib/params'
import { CARD_UPDATED } from '../../realtime/events'
import { emitToOrg } from '../../realtime/emitter'
import { MAX_IMAGE_BYTES } from '../../uploads/imageType'
import { deleteImage, uploadImage } from '../../uploads/storage'
import * as boardService from './board.service'

// Initial page load before the socket connects; live updates come over Socket.io
export async function getBoardHandler(req: Request, res: Response) {
  const state = await boardService.getBoardState(paramAsString(req.params.orgId)!)
  res.json(state)
}

// In-memory: files are small (capped) and go straight to the storage driver
const singleImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
}).single('file')

// Multer as a middleware whose errors become our HTTP errors (e.g. oversized -> 413)
export function receiveImage(req: Request, res: Response, next: NextFunction) {
  singleImage(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') next(new PayloadTooLargeError('Images must be 5 MB or smaller'))
      else next(new ValidationError('Send exactly one image in the "file" field'))
      return
    }
    next(err)
  })
}

// The card must belong to the org in the URL — the route's role/subscription checks were for
// that org, so a card from any other org is treated as not found
async function cardInOrg(req: Request) {
  const orgId = paramAsString(req.params.orgId)!
  const cardId = paramAsString(req.params.cardId)
  if (!cardId || !mongoose.isValidObjectId(cardId)) throw new NotFoundError('Card not found')
  if ((await boardService.getOrgIdForCard(cardId)) !== orgId) throw new NotFoundError('Card not found')
  return { orgId, cardId }
}

// Display-only, but keep it tidy: no paths, no control characters, bounded length
function cleanFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
  return cleaned || 'image'
}

export async function uploadAttachmentHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  if (!req.file) throw new ValidationError('Attach an image in the "file" field')

  // Validates type (by content) and size, then stores
  const stored = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype)

  let result
  try {
    result = await boardService.addAttachment(cardId, {
      ...stored,
      filename: cleanFilename(req.file.originalname),
      uploadedBy: req.user!.userId,
    })
  } catch (err) {
    // Card vanished mid-upload (e.g. deleted by someone else) — don't orphan the file
    await deleteImage(stored.publicId).catch(() => {})
    throw err
  }

  // An attachment change is a card update: everyone on the board gets it live
  emitToOrg(orgId, CARD_UPDATED, { card: result.card })
  res.status(201).json(result)
}

export async function deleteAttachmentHandler(req: Request, res: Response) {
  const { orgId, cardId } = await cardInOrg(req)
  const attachmentId = paramAsString(req.params.attachmentId)
  if (!attachmentId || !mongoose.isValidObjectId(attachmentId)) throw new NotFoundError('Attachment not found')

  const { card, publicId } = await boardService.removeAttachment(cardId, attachmentId)
  emitToOrg(orgId, CARD_UPDATED, { card })

  // The attachment is already gone from the card; a storage hiccup just leaves an orphan file
  await deleteImage(publicId).catch((err: Error) =>
    console.error(`[uploads] could not delete ${publicId}: ${err.message}`),
  )
  res.json({ card })
}
