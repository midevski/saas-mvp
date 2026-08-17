import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { env } from './config/env'
import { ConflictError, ForbiddenError, NotFoundError } from './lib/errors'
import { authRouter } from './modules/auth/auth.routes'
import { orgRouter } from './modules/orgs/org.routes'

export const app = express()

app.use(cors({ origin: env.CLIENT_URL, credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/auth', authRouter)
app.use(orgRouter)

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
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
