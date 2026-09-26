import http from 'http'
import type { AddressInfo } from 'net'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'
import { app } from '../../app'
import { createSocketServer, type AppServer } from '../../realtime/socket'
import {
  BOARD_JOIN,
  BOARD_STATE,
  CARD_CREATE,
  CARD_CREATED,
  CARD_DELETE,
  CARD_DELETED,
  CARD_MOVE,
  CARD_MOVED,
  CARD_UPDATE,
  CARD_UPDATED,
} from '../../realtime/events'
import { Subscription } from '../billing/subscription.model'
import { Card } from './card.model'
import * as boardService from './board.service'

let mongod: MongoMemoryServer
let httpServer: http.Server
let io: AppServer
let baseUrl: string
const openSockets: ClientSocket[] = []

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())

  httpServer = http.createServer(app)
  io = createSocketServer(httpServer)
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await io.close()
  await mongoose.disconnect()
  await mongod.stop()
})

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.disconnect()
  const collections = mongoose.connection.collections
  for (const name of Object.keys(collections)) {
    await collections[name]!.deleteMany({})
  }
})

async function registerUser(email: string) {
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password: 'password123', name: email })
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string, email }
}

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` }
}

async function createOrg(ownerToken: string) {
  const res = await request(app).post('/orgs').set(authed(ownerToken)).send({ name: 'Acme' })
  return res.body.org.id as string
}

async function addMember(orgId: string, ownerToken: string, member: { accessToken: string; email: string }) {
  const inviteRes = await request(app)
    .post(`/orgs/${orgId}/invites`)
    .set(authed(ownerToken))
    .send({ email: member.email, role: 'member' })
  await request(app)
    .post(`/invites/${inviteRes.body.inviteToken}/accept`)
    .set(authed(member.accessToken))
}

async function subscribe(orgId: string) {
  await Subscription.create({ orgId, stripeCustomerId: `cus_${orgId}`, status: 'active' })
}

// Owner + member in one subscribed org
async function setupSubscribedOrg() {
  const owner = await registerUser('owner@example.com')
  const member = await registerUser('member@example.com')
  const orgId = await createOrg(owner.accessToken)
  await addMember(orgId, owner.accessToken, member)
  await subscribe(orgId)
  return { owner, member, orgId }
}

function connect(token?: string): Promise<ClientSocket> {
  const socket = ioClient(baseUrl, {
    auth: token === undefined ? {} : { token },
    transports: ['websocket'],
    reconnection: false,
  })
  openSockets.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<any> {
  return socket.timeout(2000).emitWithAck(event, payload)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nextEvent(socket: ClientSocket, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 2000)
    socket.once(event, (data) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

function expectNoEvent(socket: ClientSocket, event: string, ms = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = () => reject(new Error(`unexpected ${event}`))
    socket.once(event, listener)
    setTimeout(() => {
      socket.off(event, listener)
      resolve()
    }, ms)
  })
}

async function joinBoard(socket: ClientSocket, orgId: string) {
  const statePromise = nextEvent(socket, BOARD_STATE)
  const ack = await emitAck(socket, BOARD_JOIN, { orgId })
  expect(ack).toEqual({ ok: true })
  return statePromise
}

describe('GET /orgs/:orgId/board', () => {
  it('returns the board with three default columns for a subscribed member', async () => {
    const { member, orgId } = await setupSubscribedOrg()

    const res = await request(app).get(`/orgs/${orgId}/board`).set(authed(member.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.columns.map((c: { name: string }) => c.name)).toEqual(['To Do', 'In Progress', 'Done'])
    expect(res.body.cards).toEqual([])
  })

  it('creates the board only once across repeated access', async () => {
    const { owner, orgId } = await setupSubscribedOrg()
    const first = await request(app).get(`/orgs/${orgId}/board`).set(authed(owner.accessToken))
    const second = await request(app).get(`/orgs/${orgId}/board`).set(authed(owner.accessToken))
    expect(second.body.board.id).toBe(first.body.board.id)
    expect(second.body.columns).toHaveLength(3)
  })

  it('rejects an unsubscribed org with 402', async () => {
    const owner = await registerUser('unsub@example.com')
    const orgId = await createOrg(owner.accessToken)
    const res = await request(app).get(`/orgs/${orgId}/board`).set(authed(owner.accessToken))
    expect(res.status).toBe(402)
  })

  it('rejects a non-member with 404', async () => {
    const { orgId } = await setupSubscribedOrg()
    const outsider = await registerUser('outsider@example.com')
    const res = await request(app).get(`/orgs/${orgId}/board`).set(authed(outsider.accessToken))
    expect(res.status).toBe(404)
  })
})

describe('board.service card ordering', () => {
  async function seedBoard() {
    const { owner, orgId } = await setupSubscribedOrg()
    const state = await boardService.getBoardState(orgId)
    const [todo, doing] = state.columns
    const make = (title: string, columnId: string) =>
      boardService.createCard(state.board.id, columnId, title, owner.userId)
    return { state, todo: todo!, doing: doing!, make }
  }

  async function titlesIn(columnId: string) {
    const cards = await Card.find({ columnId }).sort({ order: 1 })
    return cards.map((c) => c.title)
  }

  it('appends new cards to the bottom of the column', async () => {
    const { todo, make } = await seedBoard()
    const a = await make('A', todo.id)
    const b = await make('B', todo.id)
    expect([a.order, b.order]).toEqual([0, 1])
  })

  it('rejects creating a card in a column from another board', async () => {
    const { state } = await seedBoard()
    const otherColumnId = new mongoose.Types.ObjectId().toString()
    const userId = new mongoose.Types.ObjectId().toString()
    await expect(boardService.createCard(state.board.id, otherColumnId, 'A', userId)).rejects.toThrow(
      'Column not found',
    )
  })

  it('reorders within a column', async () => {
    const { todo, make } = await seedBoard()
    await make('A', todo.id)
    await make('B', todo.id)
    const c = await make('C', todo.id)

    await boardService.moveCard(c.id, todo.id, 0)
    expect(await titlesIn(todo.id)).toEqual(['C', 'A', 'B'])

    const cards = await Card.find({ columnId: todo.id }).sort({ order: 1 })
    expect(cards.map((card) => card.order)).toEqual([0, 1, 2])
  })

  it('moves across columns and re-sequences both', async () => {
    const { todo, doing, make } = await seedBoard()
    const a = await make('A', todo.id)
    await make('B', todo.id)
    await make('X', doing.id)

    const result = await boardService.moveCard(a.id, doing.id, 1)
    expect(result.card.columnId).toBe(doing.id)
    expect(await titlesIn(todo.id)).toEqual(['B'])
    expect(await titlesIn(doing.id)).toEqual(['X', 'A'])

    const remaining = await Card.find({ columnId: todo.id })
    expect(remaining.map((card) => card.order)).toEqual([0])
  })

  it('clamps an out-of-range target position to the end', async () => {
    const { todo, doing, make } = await seedBoard()
    const a = await make('A', todo.id)
    await make('X', doing.id)

    const result = await boardService.moveCard(a.id, doing.id, 99)
    expect(result.toOrder).toBe(1)
    expect(await titlesIn(doing.id)).toEqual(['X', 'A'])
  })
})

describe('socket handshake auth', () => {
  it('rejects a connection with no token', async () => {
    await expect(connect()).rejects.toThrow('unauthorized')
  })

  it('rejects a connection with an invalid token', async () => {
    await expect(connect('not-a-jwt')).rejects.toThrow('unauthorized')
  })

  it('accepts a connection with a valid token', async () => {
    const user = await registerUser('valid@example.com')
    const socket = await connect(user.accessToken)
    expect(socket.connected).toBe(true)
  })
})

describe('board:join', () => {
  it('sends the full board state to a subscribed member', async () => {
    const { member, orgId } = await setupSubscribedOrg()
    const socket = await connect(member.accessToken)
    const state = await joinBoard(socket, orgId)
    expect(state.columns).toHaveLength(3)
  })

  it('rejects a non-member, who then receives none of the org events', async () => {
    const { owner, orgId } = await setupSubscribedOrg()
    const outsider = await registerUser('outsider@example.com')

    const outsiderSocket = await connect(outsider.accessToken)
    const ack = await emitAck(outsiderSocket, BOARD_JOIN, { orgId })
    expect(ack).toEqual({ ok: false, error: 'not_found' })

    const ownerSocket = await connect(owner.accessToken)
    const state = await joinBoard(ownerSocket, orgId)
    const noEvent = expectNoEvent(outsiderSocket, CARD_CREATED)
    await emitAck(ownerSocket, CARD_CREATE, {
      boardId: state.board.id,
      columnId: state.columns[0].id,
      title: 'Secret',
    })
    await noEvent
  })

  it('rejects an unsubscribed org', async () => {
    const owner = await registerUser('unsub@example.com')
    const orgId = await createOrg(owner.accessToken)
    const socket = await connect(owner.accessToken)
    const ack = await emitAck(socket, BOARD_JOIN, { orgId })
    expect(ack).toEqual({ ok: false, error: 'subscription_required' })
  })

  it('rejects a malformed payload', async () => {
    const user = await registerUser('malformed@example.com')
    const socket = await connect(user.accessToken)
    const ack = await emitAck(socket, BOARD_JOIN, { orgId: 'nope' })
    expect(ack).toEqual({ ok: false, error: 'invalid_payload' })
  })
})

describe('card events', () => {
  async function twoJoinedClients() {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const a = await connect(owner.accessToken)
    const b = await connect(member.accessToken)
    const state = await joinBoard(a, orgId)
    await joinBoard(b, orgId)
    return { a, b, orgId, state, owner, member }
  }

  it('broadcasts create/move/update/delete to the rest of the room, not the sender', async () => {
    const { a, b, state } = await twoJoinedClients()
    const [todo, doing] = state.columns

    // create
    let received = nextEvent(b, CARD_CREATED)
    let senderSilent = expectNoEvent(a, CARD_CREATED)
    const created = await emitAck(a, CARD_CREATE, { boardId: state.board.id, columnId: todo.id, title: 'Task' })
    expect(created.ok).toBe(true)
    expect((await received).card).toMatchObject({ id: created.card.id, title: 'Task', columnId: todo.id })
    await senderSilent
    const cardId = created.card.id

    // move
    received = nextEvent(b, CARD_MOVED)
    senderSilent = expectNoEvent(a, CARD_MOVED)
    expect(await emitAck(a, CARD_MOVE, { cardId, toColumnId: doing.id, toOrder: 0 })).toEqual({
      ok: true,
      toOrder: 0,
    })
    expect(await received).toEqual({ cardId, toColumnId: doing.id, toOrder: 0 })
    await senderSilent
    expect((await Card.findById(cardId))!.columnId.toString()).toBe(doing.id)

    // update (from the other client this time)
    received = nextEvent(a, CARD_UPDATED)
    await emitAck(b, CARD_UPDATE, { cardId, title: 'Renamed', description: 'Details' })
    expect((await received).card).toMatchObject({ id: cardId, title: 'Renamed', description: 'Details' })

    // delete
    received = nextEvent(a, CARD_DELETED)
    await emitAck(b, CARD_DELETE, { cardId })
    expect(await received).toEqual({ cardId, columnId: doing.id })
    expect(await Card.findById(cardId)).toBeNull()
  })

  it('re-checks permissions on every event, not just on join', async () => {
    const { a, state, orgId } = await twoJoinedClients()

    await Subscription.updateOne({ orgId }, { status: 'canceled' })

    const ack = await emitAck(a, CARD_CREATE, {
      boardId: state.board.id,
      columnId: state.columns[0].id,
      title: 'After cancel',
    })
    expect(ack).toEqual({ ok: false, error: 'subscription_required' })
    expect(await Card.countDocuments()).toBe(0)
  })

  it("rejects card events from a non-member targeting another org's card", async () => {
    const { a, state } = await twoJoinedClients()
    const created = await emitAck(a, CARD_CREATE, {
      boardId: state.board.id,
      columnId: state.columns[0].id,
      title: 'Mine',
    })

    const outsider = await registerUser('outsider@example.com')
    const outsiderSocket = await connect(outsider.accessToken)

    expect(await emitAck(outsiderSocket, CARD_DELETE, { cardId: created.card.id })).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(
      await emitAck(outsiderSocket, CARD_UPDATE, { cardId: created.card.id, title: 'Hijacked' }),
    ).toEqual({ ok: false, error: 'not_found' })
    expect((await Card.findById(created.card.id))!.title).toBe('Mine')
  })
})
