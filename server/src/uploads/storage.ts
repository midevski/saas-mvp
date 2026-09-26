import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { env } from '../config/env'
import { PayloadTooLargeError, UnsupportedMediaTypeError } from '../lib/errors'
import { detectImageType, MAX_IMAGE_BYTES, type ImageType } from './imageType'

export interface StoredImage {
  url: string
  publicId: string // what deleteImage needs later: a filename (local) or a Cloudinary public_id
}

// One interface, two drivers, picked by STORAGE_DRIVER. Local disk is the zero-setup default;
// Cloudinary's free tier persists across redeploys on hosts whose disks are ephemeral.
interface StorageDriver {
  save(buffer: Buffer, type: ImageType): Promise<StoredImage>
  remove(publicId: string): Promise<void>
}

// ---------- Local disk ----------

// publicIds are generated here, so anything else (e.g. "../../etc") is refused outright
const LOCAL_ID = /^[a-f\d]{32}\.(jpg|png|gif|webp)$/

export const localDriver: StorageDriver = {
  async save(buffer, type) {
    await fs.mkdir(env.UPLOADS_DIR, { recursive: true })
    // Random name + extension from the detected type — never the client's filename
    const filename = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`
    await fs.writeFile(path.join(env.UPLOADS_DIR, filename), buffer)
    return { url: `/uploads/${filename}`, publicId: filename }
  },
  async remove(publicId) {
    if (!LOCAL_ID.test(publicId)) throw new Error(`Refusing to delete unexpected file id: ${publicId}`)
    await fs.unlink(path.join(env.UPLOADS_DIR, publicId)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err // already gone is fine
    })
  },
}

// ---------- Cloudinary (REST API via fetch — no SDK needed) ----------

const CLOUDINARY_FOLDER = 'saas-mvp'

// Cloudinary's signing scheme: sort params by name, join as k=v with '&', append the secret, SHA-1
export function cloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex')
}

async function cloudinaryRequest(action: 'upload' | 'destroy', params: Record<string, string>, file?: Blob) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME!
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signed = { ...params, timestamp }

  const form = new FormData()
  for (const [key, value] of Object.entries(signed)) form.append(key, value)
  form.append('api_key', env.CLOUDINARY_API_KEY!)
  form.append('signature', cloudinarySignature(signed, env.CLOUDINARY_API_SECRET!))
  if (file) form.append('file', file)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/${action}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Cloudinary ${action} failed: ${res.status} ${await res.text()}`)
  return res.json() as Promise<Record<string, unknown>>
}

export const cloudinaryDriver: StorageDriver = {
  async save(buffer, type) {
    const body = await cloudinaryRequest(
      'upload',
      { folder: CLOUDINARY_FOLDER },
      new Blob([new Uint8Array(buffer)], { type: type.mime }),
    )
    return { url: String(body.secure_url), publicId: String(body.public_id) }
  },
  async remove(publicId) {
    await cloudinaryRequest('destroy', { public_id: publicId })
  },
}

function driver(): StorageDriver {
  return env.STORAGE_DRIVER === 'cloudinary' ? cloudinaryDriver : localDriver
}

// ---------- Public API ----------

// Server-side enforcement — the client checks too, but only for fast feedback
export async function uploadImage(buffer: Buffer, _originalFilename: string, _mimeType: string): Promise<StoredImage> {
  if (buffer.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeError('Images must be 5 MB or smaller')
  const type = detectImageType(buffer)
  if (!type) throw new UnsupportedMediaTypeError('Only JPEG, PNG, WebP and GIF images are allowed')
  return driver().save(buffer, type)
}

export async function deleteImage(publicId: string): Promise<void> {
  await driver().remove(publicId)
}
