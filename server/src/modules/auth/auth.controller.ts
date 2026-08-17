import type { Request, Response } from 'express'
import { z } from 'zod'
import { env } from '../../config/env'
import * as authService from './auth.service'
import { AuthError } from './auth.service'

const REFRESH_COOKIE = 'refreshToken'
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  })
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
  })
}

function toPublicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name }
}

export async function registerHandler(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  try {
    const { user, accessToken, refreshToken } = await authService.register(
      parsed.data.email,
      parsed.data.password,
      parsed.data.name,
    )
    setRefreshCookie(res, refreshToken)
    res.status(201).json({ accessToken, user: toPublicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(409).json({ error: err.message })
      return
    }
    throw err
  }
}

export async function loginHandler(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  try {
    const { user, accessToken, refreshToken } = await authService.login(
      parsed.data.email,
      parsed.data.password,
    )
    setRefreshCookie(res, refreshToken)
    res.json({ accessToken, user: toPublicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      // Same message whether the email doesn't exist or the password is wrong
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }
    throw err
  }
}

export async function refreshHandler(req: Request, res: Response) {
  const token: unknown = req.cookies?.[REFRESH_COOKIE]
  if (typeof token !== 'string') {
    res.status(401).json({ error: 'Missing refresh token' })
    return
  }

  try {
    const { user, accessToken, refreshToken } = await authService.refresh(token)
    setRefreshCookie(res, refreshToken)
    res.json({ accessToken, user: toPublicUser(user) })
  } catch (err) {
    if (err instanceof AuthError) {
      clearRefreshCookie(res)
      res.status(401).json({ error: 'Invalid refresh token' })
      return
    }
    throw err
  }
}

export async function logoutHandler(req: Request, res: Response) {
  const token: unknown = req.cookies?.[REFRESH_COOKIE]
  if (typeof token === 'string') {
    await authService.logout(token)
  }
  clearRefreshCookie(res)
  res.status(204).end()
}

export function meHandler(req: Request, res: Response) {
  res.json({ user: req.user })
}
