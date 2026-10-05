import http from 'http'
import type { AddressInfo } from 'net'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { app } from '../../app'
import { createSocketServer, type AppServer } from '../../realtime/socket'
import { BOARD_JOIN, CARD_ACTIVITY, NOTIFICATION_NEW, NOTIFICATION_READ } from '../../realtime/events'
import { Subscription } from '../billing/subscription.model'
import * as boardService from '../board/board.service'
import { Notification } from './notification.model'

let mongod: MongoMemoryServer
let httpServer: http.Server
let io: AppServer
let baseUrl: string
const openSockets: ClientSocket[] = []

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  httpServer = http.createServer(app)
  ;({ io } = createSocketServer(httpServer))
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await io.close()
  await mongoose.disconnect()
  await mongod.stop()
})

afterEach(async () => {
  jest.restoreAllMocks()
  for (const socket of openSockets.splice(0)) socket.disconnect()
  for (const name of Object.keys(mongoose.connection.collections)) {
    await mongoose.connection.collections[name]!.deleteMany({})
  }
})

type User = { accessToken: string; userId: string; email: string; name: string }

async function registerUser(name: string, email: string): Promise<User> {
  const res = await request(app).post('/auth/register').send({ email, password: 'password123', name })
  return { accessToken: res.body.accessToken, userId: res.body.user.id, email, name }
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` })

async function addMember(orgId: string, ownerToken: string, user: User) {
  const invite = await request(app).post(`/orgs/${orgId}/invites`).set(authed(ownerToken)).send({ email: user.email, role: 'member' })
  await request(app).post(`/invites/${invite.body.inviteToken}/accept`).set(authed(user.accessToken))
}

// Sarah (owner) and Max + Lou (members) in one subscribed org, with a card
async function setup() {
  const sarah = await registerUser('Sarah Connor', 'sarah@example.com')
  const max = await registerUser('Max Member', 'max@example.com')
  const lou = await registerUser('Lou Lurker', 'lou@example.com')
  const orgId = (await request(app).post('/orgs').set(authed(sarah.accessToken)).send({ name: 'Acme' })).body.org.id as string
  await addMember(orgId, sarah.accessToken, max)
  await addMember(orgId, sarah.accessToken, lou)
  await Subscription.create({ orgId, stripeCustomerId: `cus_${orgId}`, status: 'active' })
  const state = await boardService.getBoardState(orgId)
  const card = await boardService.createCard(state.board.id, state.columns[0]!.id, 'Launch plan', sarah.userId)
  const cardPath = `/orgs/${orgId}/board/cards/${card.id}`
  return { sarah, max, lou, orgId, card, cardPath }
}

function comment(cardPath: string, token: string, text: string, mentionedUserIds: string[] = []) {
  return request(app).post(`${cardPath}/comments`).set(authed(token)).send({ text, mentionedUserIds })
}

const list = (token: string, query = '') => request(app).get(`/notifications${query}`).set(authed(token))
const unread = async (token: string) =>
  (await request(app).get('/notifications/unread-count').set(authed(token))).body.count as number
const markRead = (token: string, id: string) => request(app).patch(`/notifications/${id}/read`).set(authed(token))
const markAllRead = (token: string) => request(app).patch('/notifications/read-all').set(authed(token))

function connect(token: string): Promise<ClientSocket> {
  const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false })
  openSockets.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

// Every event of a kind a socket receives
function collect(socket: ClientSocket, event: string) {
  const received: unknown[] = []
  socket.on(event, (payload) => received.push(payload))
  return received
}
const settle = () => new Promise((r) => setTimeout(r, 150))

describe('mention notifications', () => {
  it('creates exactly one notification for the mentioned user, with a precomputed snippet', async () => {
    const { sarah, max, lou, orgId, card, cardPath } = await setup()
    const posted = await comment(cardPath, sarah.accessToken, 'Can you check this before Friday?', [max.userId])
    expect(posted.status).toBe(201)

    const res = await list(max.accessToken)
    expect(res.status).toBe(200)
    expect(res.body.notifications).toEqual([
      {
        id: expect.any(String),
        type: 'mention',
        actor: { id: sarah.userId, name: 'Sarah Connor' },
        orgId,
        cardId: card.id,
        activityId: posted.body.entry.id,
        text: 'Sarah Connor mentioned you on "Launch plan": "Can you check this before Friday?"',
        read: false,
        createdAt: expect.any(String),
      },
    ])
    expect(await unread(max.accessToken)).toBe(1)
    // Nobody else gets one
    expect(await unread(lou.accessToken)).toBe(0)
    expect(await unread(sarah.accessToken)).toBe(0)
    expect(await Notification.countDocuments()).toBe(1)
  })

  it('never notifies you for mentioning yourself, and notifies each person once', async () => {
    const { sarah, max, cardPath } = await setup()
    await comment(cardPath, sarah.accessToken, 'Note to self', [sarah.userId])
    expect(await Notification.countDocuments()).toBe(0)

    await comment(cardPath, sarah.accessToken, '@Me and @Max @Max', [sarah.userId, max.userId, max.userId])
    expect(await unread(sarah.accessToken)).toBe(0)
    expect(await unread(max.accessToken)).toBe(1)
  })

  it('creates nothing for a comment without mentions, or for ids that were dropped as non-members', async () => {
    const { sarah, cardPath } = await setup()
    const outsider = await registerUser('Olivia Outsider', 'olivia@example.com')
    await comment(cardPath, sarah.accessToken, 'Plain comment')
    await comment(cardPath, sarah.accessToken, 'Spoofed', [outsider.userId])
    expect(await Notification.countDocuments()).toBe(0)
    expect(await unread(outsider.accessToken)).toBe(0)
  })

  it('shortens long comments and titles in the snippet', async () => {
    const { sarah, max, cardPath } = await setup()
    await comment(cardPath, sarah.accessToken, `${'word '.repeat(60)}end`, [max.userId])
    const [n] = (await list(max.accessToken)).body.notifications
    expect(n.text.length).toBeLessThan(180)
    expect(n.text).toMatch(/…"$/)
  })

  it("still posts the comment if creating the notification fails", async () => {
    const { sarah, max, cardPath } = await setup()
    jest.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('db hiccup'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {})

    const posted = await comment(cardPath, sarah.accessToken, 'Important', [max.userId])
    expect(posted.status).toBe(201)
    const feed = await request(app).get(`${cardPath}/activity`).set(authed(sarah.accessToken))
    expect(feed.body.entries.map((e: { text: string }) => e.text)).toContain('Important')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('[notifications]'))
  })
})

describe('live delivery over the per-user room', () => {
  it("reaches the recipient on any page (no board joined), in every tab, and nobody else", async () => {
    const { sarah, max, lou, cardPath } = await setup()
    const maxTab1 = await connect(max.accessToken) // e.g. on the dashboard
    const maxTab2 = await connect(max.accessToken)
    const louTab = await connect(lou.accessToken)
    const sarahTab = await connect(sarah.accessToken)
    const got = {
      max1: collect(maxTab1, NOTIFICATION_NEW),
      max2: collect(maxTab2, NOTIFICATION_NEW),
      lou: collect(louTab, NOTIFICATION_NEW),
      sarah: collect(sarahTab, NOTIFICATION_NEW),
    }

    await comment(cardPath, sarah.accessToken, 'Ping', [max.userId])
    await settle()

    const [stored] = (await list(max.accessToken)).body.notifications
    expect(got.max1).toEqual([{ notification: stored }])
    expect(got.max2).toEqual([{ notification: stored }])
    expect(got.lou).toEqual([])
    expect(got.sarah).toEqual([])
  })

  it("doesn't interfere with the org room: on the board you get the feed entry and the notification, once each", async () => {
    const { sarah, max, lou, orgId, cardPath } = await setup()
    const maxSocket = await connect(max.accessToken)
    const louSocket = await connect(lou.accessToken)
    for (const socket of [maxSocket, louSocket]) {
      expect(await socket.timeout(2000).emitWithAck(BOARD_JOIN, { orgId })).toEqual({ ok: true })
    }
    const maxActivity = collect(maxSocket, CARD_ACTIVITY)
    const maxNotifications = collect(maxSocket, NOTIFICATION_NEW)
    const louActivity = collect(louSocket, CARD_ACTIVITY)
    const louNotifications = collect(louSocket, NOTIFICATION_NEW)

    await comment(cardPath, sarah.accessToken, 'Board + bell', [max.userId])
    await settle()

    expect(maxActivity).toHaveLength(1)
    expect(maxNotifications).toHaveLength(1)
    expect(louActivity).toHaveLength(1) // board events still reach the whole org room
    expect(louNotifications).toHaveLength(0)
  })
})

describe('reading notifications', () => {
  async function withNotifications(count: number) {
    const s = await setup()
    for (let i = 1; i <= count; i++) await comment(s.cardPath, s.sarah.accessToken, `Comment ${i}`, [s.max.userId])
    return s
  }

  it('lists newest first with cursor pagination', async () => {
    const { max } = await withNotifications(5)
    const first = await list(max.accessToken, '?limit=2')
    expect(first.body.notifications.map((n: { text: string }) => n.text.match(/Comment \d/)![0])).toEqual([
      'Comment 5',
      'Comment 4',
    ])
    const second = await list(max.accessToken, `?limit=2&before=${first.body.nextCursor}`)
    expect(second.body.notifications.map((n: { text: string }) => n.text.match(/Comment \d/)![0])).toEqual([
      'Comment 3',
      'Comment 2',
    ])
    const last = await list(max.accessToken, `?limit=2&before=${second.body.nextCursor}`)
    expect(last.body.notifications).toHaveLength(1)
    expect(last.body.nextCursor).toBeNull()
  })

  it('validates pagination parameters', async () => {
    const { max } = await withNotifications(1)
    for (const query of ['?limit=0', '?limit=51', '?limit=abc', '?before=nope']) {
      expect((await list(max.accessToken, query)).status).toBe(400)
    }
  })

  it('marks one as read and returns the new unread count', async () => {
    const { max } = await withNotifications(3)
    const [newest] = (await list(max.accessToken)).body.notifications
    const res = await markRead(max.accessToken, newest.id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 2 })
    expect(await unread(max.accessToken)).toBe(2)
    expect((await list(max.accessToken)).body.notifications[0].read).toBe(true)
    // Idempotent
    expect((await markRead(max.accessToken, newest.id)).body).toEqual({ count: 2 })
  })

  it("can't mark someone else's notification as read — it's simply not found", async () => {
    const { max, lou, sarah } = await withNotifications(1)
    const [theirs] = (await list(max.accessToken)).body.notifications
    expect((await markRead(lou.accessToken, theirs.id)).status).toBe(404)
    expect((await markRead(sarah.accessToken, theirs.id)).status).toBe(404) // not even the actor
    expect(await unread(max.accessToken)).toBe(1)
    expect((await markRead(lou.accessToken, 'not-an-id')).status).toBe(404)
    expect((await markRead(lou.accessToken, new mongoose.Types.ObjectId().toString())).status).toBe(404)
  })

  it('"mark all as read" clears only your own', async () => {
    const { max, lou, sarah, cardPath } = await withNotifications(3)
    await comment(cardPath, sarah.accessToken, 'For Lou', [lou.userId])
    const res = await markAllRead(max.accessToken)
    expect(res.body).toEqual({ count: 0 })
    expect(await unread(max.accessToken)).toBe(0)
    expect((await list(max.accessToken)).body.notifications.every((n: { read: boolean }) => n.read)).toBe(true)
    expect(await unread(lou.accessToken)).toBe(1)
  })

  it("tells the user's other tabs when something was read", async () => {
    const { max } = await withNotifications(2)
    const otherTab = await connect(max.accessToken)
    const received = collect(otherTab, NOTIFICATION_READ)
    const [newest] = (await list(max.accessToken)).body.notifications
    await markRead(max.accessToken, newest.id)
    await markAllRead(max.accessToken)
    await settle()
    expect(received).toEqual([{ notificationIds: [newest.id] }, { all: true }])
  })

  it('persists across logging out and back in', async () => {
    const { max } = await withNotifications(2)
    await request(app).post('/auth/logout').set(authed(max.accessToken))
    const login = await request(app).post('/auth/login').send({ email: max.email, password: 'password123' })
    const freshToken = login.body.accessToken as string
    expect(await unread(freshToken)).toBe(2)
    expect((await list(freshToken)).body.notifications).toHaveLength(2)
  })

  it("hides notifications from orgs you've left, and deletes them with the org", async () => {
    const { max, sarah, orgId } = await withNotifications(2)
    await request(app).delete(`/orgs/${orgId}/members/${max.userId}`).set(authed(sarah.accessToken))
    expect(await unread(max.accessToken)).toBe(0)
    expect((await list(max.accessToken)).body.notifications).toEqual([])

    await request(app).delete(`/orgs/${orgId}`).set(authed(sarah.accessToken)).send({ confirmName: 'Acme' })
    expect(await Notification.countDocuments()).toBe(0)
  })

  it('requires being signed in', async () => {
    const id = new mongoose.Types.ObjectId().toString()
    expect((await request(app).get('/notifications')).status).toBe(401)
    expect((await request(app).get('/notifications/unread-count')).status).toBe(401)
    expect((await request(app).patch(`/notifications/${id}/read`)).status).toBe(401)
    expect((await request(app).patch('/notifications/read-all')).status).toBe(401)
  })
})
