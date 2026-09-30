import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { env } from './config/env'
import {
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './lib/errors'
import { authRouter } from './modules/auth/auth.routes'
import { orgRouter } from './modules/orgs/org.routes'
import { billingRouter, billingWebhookRouter } from './modules/billing/billing.routes'
import { boardRouter } from './modules/board/board.routes'

export const app = express()

app.use(cors({ origin: env.CLIENT_URL, credentials: true }))

// Mounted before express.json(): Stripe webhook signature verification needs the raw body
app.use(billingWebhookRouter)

app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Card images stored on local disk (the Cloudinary driver serves its own URLs instead).
// Files have random, unguessable names and never change, so they cache forever; the headers
// make sure a file can only ever be treated as the image it was validated to be.
if (env.STORAGE_DRIVER === 'local') {
  app.use(
    '/uploads',
    express.static(env.UPLOADS_DIR, {
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
      immutable: true,
      maxAge: '365d',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Security-Policy', "default-src 'none'")
      },
    }),
  )
}

app.use('/auth', authRouter)
app.use(orgRouter)
app.use(billingRouter)
app.use(boardRouter)

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message })
    return
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message })
    return
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message })
    return
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (err instanceof PayloadTooLargeError) {
    res.status(413).json({ error: err.message })
    return
  }
  if (err instanceof UnsupportedMediaTypeError) {
    res.status(415).json({ error: err.message })
    return
  }
  if (err instanceof ExternalServiceError) {
    res.status(502).json({ error: err.message })
    return
  }
  // express.static with fallthrough: false -> missing upload
  if ((err as { status?: number }).status === 404) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
