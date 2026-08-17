import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { app } from '../../app'
import { env } from '../../config/env'

let mongod: MongoMemoryServer

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

afterEach(async () => {
  const collections = mongoose.connection.collections
  for (const name of Object.keys(collections)) {
    await collections[name]!.deleteMany({})
  }
})

const credentials = { email: 'test@example.com', password: 'password123', name: 'Test User' }

describe('POST /auth/register', () => {
  it('creates a user and returns an access token + refresh cookie', async () => {
    const res = await request(app).post('/auth/register').send(credentials)

    expect(res.status).toBe(201)
    expect(res.body.accessToken).toEqual(expect.any(String))
    expect(res.body.user.email).toBe(credentials.email)
    expect(res.body.user.passwordHash).toBeUndefined()
    expect(res.headers['set-cookie']?.[0]).toMatch(/^refreshToken=.+HttpOnly/)
  })

  it('rejects a duplicate email', async () => {
    await request(app).post('/auth/register').send(credentials)
    const res = await request(app).post('/auth/register').send(credentials)

    expect(res.status).toBe(409)
  })
})

describe('POST /auth/login', () => {
  it('logs in with correct credentials', async () => {
    await request(app).post('/auth/register').send(credentials)
    const res = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toEqual(expect.any(String))
  })

  it('rejects a wrong password without revealing the email exists', async () => {
    await request(app).post('/auth/register').send(credentials)
    const wrongPasswordRes = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' })
    const unknownEmailRes = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })

    expect(wrongPasswordRes.status).toBe(401)
    expect(unknownEmailRes.status).toBe(401)
    expect(wrongPasswordRes.body.error).toBe(unknownEmailRes.body.error)
  })
})

describe('POST /auth/refresh', () => {
  it('rotates the refresh token, invalidating the previous one', async () => {
    const registerRes = await request(app).post('/auth/register').send(credentials)
    const firstCookie = registerRes.headers['set-cookie'] as unknown as string[]

    const refreshRes = await request(app).post('/auth/refresh').set('Cookie', firstCookie)
    expect(refreshRes.status).toBe(200)
    const secondCookie = refreshRes.headers['set-cookie'] as unknown as string[]
    expect(secondCookie[0]).not.toBe(firstCookie[0])

    const reuseOldRes = await request(app).post('/auth/refresh').set('Cookie', firstCookie)
    expect(reuseOldRes.status).toBe(401)

    const useNewRes = await request(app).post('/auth/refresh').set('Cookie', secondCookie)
    expect(useNewRes.status).toBe(200)
  })

  it('rejects a missing refresh token', async () => {
    const res = await request(app).post('/auth/refresh')
    expect(res.status).toBe(401)
  })
})

describe('POST /auth/logout', () => {
  it('invalidates the refresh token and clears the cookie', async () => {
    const registerRes = await request(app).post('/auth/register').send(credentials)
    const cookie = registerRes.headers['set-cookie'] as unknown as string[]

    const logoutRes = await request(app).post('/auth/logout').set('Cookie', cookie)
    expect(logoutRes.status).toBe(204)

    const refreshRes = await request(app).post('/auth/refresh').set('Cookie', cookie)
    expect(refreshRes.status).toBe(401)
  })
})

describe('GET /auth/me', () => {
  it('rejects a missing access token', async () => {
    const res = await request(app).get('/auth/me')
    expect(res.status).toBe(401)
  })

  it('rejects an expired access token', async () => {
    const expiredToken = jwt.sign({ userId: 'u1', email: credentials.email }, env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: -1,
    })
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${expiredToken}`)
    expect(res.status).toBe(401)
  })

  it('rejects a tampered access token', async () => {
    const registerRes = await request(app).post('/auth/register').send(credentials)
    const tampered = `${registerRes.body.accessToken as string}tamper`
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${tampered}`)
    expect(res.status).toBe(401)
  })

  it('returns the current user for a valid access token', async () => {
    const registerRes = await request(app).post('/auth/register').send(credentials)
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${registerRes.body.accessToken as string}`)

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(credentials.email)
  })
})
