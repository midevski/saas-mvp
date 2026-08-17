import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { User } from '../users/user.model'
import { RefreshToken } from './refreshToken.model'

const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const BCRYPT_COST = 12

export class AuthError extends Error {}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function signAccessToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL,
  })
}

async function issueTokenPair(userId: string, email: string) {
  const accessToken = signAccessToken(userId, email)

  const refreshToken = crypto.randomBytes(32).toString('hex')
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  })

  return { accessToken, refreshToken }
}

export async function register(email: string, password: string, name: string) {
  const existing = await User.findOne({ email })
  if (existing) throw new AuthError('Email already registered')

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  const user = await User.create({ email, passwordHash, name })

  const tokens = await issueTokenPair(user.id, user.email)
  return { user, ...tokens }
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ email })
  if (!user) throw new AuthError('Invalid email or password')

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new AuthError('Invalid email or password')

  const tokens = await issueTokenPair(user.id, user.email)
  return { user, ...tokens }
}

export async function refresh(rawRefreshToken: string) {
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawRefreshToken) })
  if (!stored || stored.expiresAt < new Date()) {
    throw new AuthError('Invalid refresh token')
  }

  const user = await User.findById(stored.userId)
  if (!user) throw new AuthError('Invalid refresh token')

  // Rotate: invalidate the used token before issuing its replacement
  await RefreshToken.deleteOne({ _id: stored._id })
  const tokens = await issueTokenPair(user.id, user.email)
  return { user, ...tokens }
}

export async function logout(rawRefreshToken: string) {
  await RefreshToken.deleteOne({ tokenHash: hashToken(rawRefreshToken) })
}

export async function logoutAll(userId: string) {
  await RefreshToken.deleteMany({ userId })
}
