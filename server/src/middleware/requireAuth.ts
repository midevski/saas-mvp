import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../modules/auth/auth.service'

export interface AuthPayload {
  userId: string
  email: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing access token' })
    return
  }

  const token = header.slice('Bearer '.length)

  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token' })
  }
}
