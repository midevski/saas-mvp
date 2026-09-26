import fs from 'fs/promises'
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
  BOARD_LEAVE,
  CURSOR_MOVE,
  CURSOR_UPDATE,
  PRESENCE_UPDATE,
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

describe('board presence', () => {
  // Resolves with the first presence:update whose online list matches `expected`
  function presenceBecomes(socket: ClientSocket, expected: string[]): Promise<void> {
    const want = [...expected].sort().join(',')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(PRESENCE_UPDATE, listener)
        reject(new Error(`presence never became [${want}]`))
      }, 2000)
      const listener = ({ onlineUserIds }: { onlineUserIds: string[] }) => {
        if ([...onlineUserIds].sort().join(',') !== want) return
        clearTimeout(timer)
        socket.off(PRESENCE_UPDATE, listener)
        resolve()
      }
      socket.on(PRESENCE_UPDATE, listener)
    })
  }

  async function join(socket: ClientSocket, orgId: string) {
    expect(await emitAck(socket, BOARD_JOIN, { orgId })).toEqual({ ok: true })
  }

  it('broadcasts the online list to everyone in the room, including the joiner', async () => {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const a = await connect(owner.accessToken)
    const b = await connect(member.accessToken)

    const aSeesSelf = presenceBecomes(a, [owner.userId])
    await join(a, orgId)
    await aSeesSelf

    const aSeesBoth = presenceBecomes(a, [owner.userId, member.userId])
    const bSeesBoth = presenceBecomes(b, [owner.userId, member.userId])
    await join(b, orgId)
    await Promise.all([aSeesBoth, bSeesBoth])
  })

  it('keeps a user online until their last tab for that org disconnects', async () => {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const tab1 = await connect(owner.accessToken)
    const tab2 = await connect(owner.accessToken)
    const watcher = await connect(member.accessToken)
    await join(tab1, orgId)
    await join(tab2, orgId)
    const both = presenceBecomes(watcher, [owner.userId, member.userId])
    await join(watcher, orgId)
    await both

    // Closing one tab: the update still lists the owner
    const stillOnline = presenceBecomes(watcher, [owner.userId, member.userId])
    tab1.disconnect()
    await stillOnline

    const ownerGone = presenceBecomes(watcher, [member.userId])
    tab2.disconnect()
    await ownerGone
  })

  it('removes a user who leaves the board but keeps their socket connected', async () => {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const a = await connect(owner.accessToken)
    const b = await connect(member.accessToken)
    await join(a, orgId)
    const both = presenceBecomes(b, [owner.userId, member.userId])
    await join(b, orgId)
    await both

    const ownerGone = presenceBecomes(b, [member.userId])
    expect(await emitAck(a, BOARD_LEAVE, {})).toEqual({ ok: true })
    await ownerGone
    expect(a.connected).toBe(true)
    // Having left the room, the owner no longer receives board events
    const noEvent = expectNoEvent(a, PRESENCE_UPDATE)
    const bRejoin = presenceBecomes(b, [member.userId])
    await emitAck(b, BOARD_LEAVE, {})
    await join(b, orgId)
    await bRejoin
    await noEvent
  })

  it('never lists a rejected non-member', async () => {
    const { owner, orgId } = await setupSubscribedOrg()
    const outsider = await registerUser('outsider@example.com')
    const a = await connect(owner.accessToken)
    const onlyOwner = presenceBecomes(a, [owner.userId])
    await join(a, orgId)
    await onlyOwner

    const o = await connect(outsider.accessToken)
    const noUpdate = expectNoEvent(a, PRESENCE_UPDATE)
    expect(await emitAck(o, BOARD_JOIN, { orgId })).toEqual({ ok: false, error: 'not_found' })
    await noUpdate
  })

  it("drops a user from an org's presence when they switch to another org's board", async () => {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const otherOrgRes = await request(app).post('/orgs').set(authed(owner.accessToken)).send({ name: 'Other' })
    const otherOrgId = otherOrgRes.body.org.id as string
    await subscribe(otherOrgId)

    const a = await connect(owner.accessToken)
    const b = await connect(member.accessToken)
    await join(a, orgId)
    const both = presenceBecomes(b, [owner.userId, member.userId])
    await join(b, orgId)
    await both

    const ownerGone = presenceBecomes(b, [member.userId])
    await join(a, otherOrgId)
    await ownerGone
  })
})

describe('board presence ordering', () => {
  it('a leave sent right after a join is applied after it, not before', async () => {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const watcher = await connect(member.accessToken)
    await emitAck(watcher, BOARD_JOIN, { orgId })

    const a = await connect(owner.accessToken)
    // Fire both without waiting — the join is still checking membership when the leave arrives
    const joinAck = emitAck(a, BOARD_JOIN, { orgId })
    const leaveAck = emitAck(a, BOARD_LEAVE, {})
    await Promise.all([joinAck, leaveAck])

    // Ask for a fresh broadcast; the owner must not be left behind as a phantom
    const updates: string[][] = []
    watcher.on(PRESENCE_UPDATE, ({ onlineUserIds }: { onlineUserIds: string[] }) => updates.push(onlineUserIds))
    await emitAck(watcher, BOARD_LEAVE, {})
    const other = await connect(member.accessToken)
    await emitAck(other, BOARD_JOIN, { orgId })
    await new Promise((r) => setTimeout(r, 200))
    expect(updates.at(-1)).toEqual([member.userId])
  })
})

describe('live cursors', () => {
  async function twoOnBoard() {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const a = await connect(owner.accessToken)
    const b = await connect(member.accessToken)
    await joinBoard(a, orgId)
    await joinBoard(b, orgId)
    return { a, b, owner, member, orgId }
  }

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('relays positions to the rest of the room with the server-attached userId', async () => {
    const { a, b, owner, orgId } = await twoOnBoard()

    const received = nextEvent(b, CURSOR_UPDATE)
    const senderSilent = expectNoEvent(a, CURSOR_UPDATE)
    // A forged userId in the payload is ignored
    a.emit(CURSOR_MOVE, { orgId, x: 412.5, y: 220, area: 'board', userId: 'someone-else' })

    expect(await received).toEqual({ userId: owner.userId, x: 412.5, y: 220, area: 'board' })
    await senderSilent
  })

  it('relays page-area positions, including negative ones in the page margins', async () => {
    const { a, b, owner, orgId } = await twoOnBoard()
    const received = nextEvent(b, CURSOR_UPDATE)
    a.emit(CURSOR_MOVE, { orgId, x: -120, y: 35, area: 'page' })
    expect(await received).toEqual({ userId: owner.userId, x: -120, y: 35, area: 'page' })
  })

  it('relays positions inside a scrollable column list, with that column', async () => {
    const { a, b, owner, orgId } = await twoOnBoard()
    const columnId = new mongoose.Types.ObjectId().toString()

    const received = nextEvent(b, CURSOR_UPDATE)
    a.emit(CURSOR_MOVE, { orgId, x: 40, y: 910, area: 'column', columnId })
    expect(await received).toEqual({ userId: owner.userId, x: 40, y: 910, area: 'column', columnId })

    // A column position without its column is meaningless and is dropped
    const nothing = expectNoEvent(b, CURSOR_UPDATE)
    await new Promise((r) => setTimeout(r, 20))
    a.emit(CURSOR_MOVE, { orgId, x: 40, y: 10, area: 'column' })
    await nothing
  })

  it('relays "left the board" as null coordinates', async () => {
    const { a, b, owner, orgId } = await twoOnBoard()
    const received = nextEvent(b, CURSOR_UPDATE)
    a.emit(CURSOR_MOVE, { orgId, x: null, y: null })
    expect(await received).toEqual({ userId: owner.userId, x: null, y: null, area: null })
  })

  it("ignores cursors from sockets that haven't joined that org's board", async () => {
    const { b, orgId } = await twoOnBoard()
    const outsider = await registerUser('outsider@example.com')
    const o = await connect(outsider.accessToken)
    const notJoined = await connect((await registerUser('lurker@example.com')).accessToken)

    const nothing = expectNoEvent(b, CURSOR_UPDATE)
    o.emit(CURSOR_MOVE, { orgId, x: 10, y: 10, area: 'board' }) // not a member at all
    notJoined.emit(CURSOR_MOVE, { orgId, x: 10, y: 10, area: 'board' }) // never joined the board
    await nothing
  })

  it('drops malformed coordinates', async () => {
    const { a, b, orgId } = await twoOnBoard()
    const nothing = expectNoEvent(b, CURSOR_UPDATE)
    for (const bad of [
      { orgId, x: 10, y: 10 }, // no area
      { orgId, x: 10, y: 10, area: 'sidebar' }, // unknown area
      { orgId, x: 10, y: 'up', area: 'board' },
      { orgId, x: 1e9, y: 10, area: 'board' },
      { orgId, x: -9_999, y: 10, area: 'page' },
      { orgId, x: 10, y: null, area: 'board' },
      { orgId: 'nope', x: 10, y: 10, area: 'board' },
    ]) {
      a.emit(CURSOR_MOVE, bad)
      await pause(20)
    }
    await nothing
  })

  it('drops floods faster than a sane cursor rate', async () => {
    const { a, b, orgId } = await twoOnBoard()
    const updates: unknown[] = []
    b.on(CURSOR_UPDATE, (u) => updates.push(u))

    for (let i = 0; i < 20; i++) a.emit(CURSOR_MOVE, { orgId, x: i, y: i, area: 'board' }) // all in one tick
    await pause(300)

    expect(updates.length).toBeGreaterThan(0)
    expect(updates.length).toBeLessThan(5)
  })

  it('never writes cursor data to MongoDB', async () => {
    const { a, b, orgId } = await twoOnBoard()
    const counts = async () => {
      const collections = await mongoose.connection.db!.listCollections().toArray()
      const entries = await Promise.all(
        collections.map(async (c) => [c.name, await mongoose.connection.db!.collection(c.name).countDocuments()]),
      )
      return Object.fromEntries(entries)
    }
    const before = await counts()

    const received = nextEvent(b, CURSOR_UPDATE)
    for (let i = 0; i < 5; i++) {
      a.emit(CURSOR_MOVE, { orgId, x: 100 + i, y: 50, area: 'board' })
      await pause(40)
    }
    await received

    expect(await counts()).toEqual(before)
  })
})

describe('card attachments', () => {
  const uploadsDir = process.env.UPLOADS_DIR!
  // Real 1x1 PNG, plus minimal headers for the other accepted formats
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)])
  const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(64)])

  async function filesOnDisk() {
    return fs.readdir(uploadsDir).catch(() => [] as string[])
  }

  async function setupCard() {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const state = await boardService.getBoardState(orgId)
    const card = await boardService.createCard(state.board.id, state.columns[0]!.id, 'With pics', owner.userId)
    return { owner, member, orgId, card, path: `/orgs/${orgId}/board/cards/${card.id}/attachments` }
  }

  function upload(path: string, token: string, file: Buffer, filename: string, contentType: string) {
    return request(app).post(path).set(authed(token)).attach('file', file, { filename, contentType })
  }

  it.each([
    ['PNG', PNG, 'photo.png', 'image/png'],
    ['JPEG', JPEG, 'photo.jpg', 'image/jpeg'],
    ['WebP', WEBP, 'photo.webp', 'image/webp'],
  ])('stores a %s, attaches it to the card and serves it back', async (_kind, file, filename, contentType) => {
    const { member, path, card, orgId } = await setupCard()

    const res = await upload(path, member.accessToken, file, filename, contentType)
    expect(res.status).toBe(201)
    expect(res.body.attachment).toMatchObject({ filename, uploadedBy: member.userId })
    expect(res.body.card.attachments).toHaveLength(1)

    // Served from local storage with safe headers
    const served = await request(app).get(res.body.attachment.url)
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toBe(contentType)
    expect(served.headers['x-content-type-options']).toBe('nosniff')

    // And it's part of the card everywhere the card is read
    const board = await request(app).get(`/orgs/${orgId}/board`).set(authed(member.accessToken))
    expect(board.body.cards.find((c: { id: string }) => c.id === card.id).attachments).toHaveLength(1)
  })

  it('broadcasts the change as card:updated to everyone on the board', async () => {
    const { owner, member, orgId, path, card } = await setupCard()
    const viewer = await connect(owner.accessToken)
    await joinBoard(viewer, orgId)

    const update = nextEvent(viewer, CARD_UPDATED)
    await upload(path, member.accessToken, PNG, 'live.png', 'image/png')
    const { card: updated } = await update
    expect(updated.id).toBe(card.id)
    expect(updated.attachments.map((a: { filename: string }) => a.filename)).toEqual(['live.png'])
  })

  it.each([
    ['a text file', Buffer.from('just some notes'), 'notes.txt', 'text/plain'],
    ['a PDF', Buffer.from('%PDF-1.7\n...'), 'doc.pdf', 'application/pdf'],
    ['text disguised as a PNG', Buffer.from('<script>alert(1)</script>'), 'evil.png', 'image/png'],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'icon.svg', 'image/svg+xml'],
  ])('rejects %s by its content, storing nothing', async (_kind, file, filename, contentType) => {
    const { member, path, card } = await setupCard()
    const before = await filesOnDisk()

    const res = await upload(path, member.accessToken, file, filename, contentType)
    expect(res.status).toBe(415)
    expect(res.body.error).toMatch(/JPEG, PNG, WebP and GIF/)
    expect(await filesOnDisk()).toEqual(before)
    expect((await Card.findById(card.id))!.attachments).toHaveLength(0)
  })

  it('rejects an image over 5 MB, storing nothing', async () => {
    const { member, path } = await setupCard()
    const before = await filesOnDisk()
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])

    const res = await upload(path, member.accessToken, huge, 'huge.png', 'image/png')
    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/5 MB/)
    expect(await filesOnDisk()).toEqual(before)
  })

  it('requires a file', async () => {
    const { member, path } = await setupCard()
    const res = await request(app).post(path).set(authed(member.accessToken))
    expect(res.status).toBe(400)
  })

  it('deletes one attachment, its file, and nothing else', async () => {
    const { owner, member, orgId, path } = await setupCard()
    const first = (await upload(path, member.accessToken, PNG, 'keep.png', 'image/png')).body.attachment
    const second = (await upload(path, member.accessToken, JPEG, 'remove.jpg', 'image/jpeg')).body.attachment
    const secondFile = second.url.replace('/uploads/', '')
    expect(await filesOnDisk()).toContain(secondFile)

    const viewer = await connect(owner.accessToken)
    await joinBoard(viewer, orgId)
    const update = nextEvent(viewer, CARD_UPDATED)

    const res = await request(app).delete(`${path}/${second.id}`).set(authed(member.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.card.attachments.map((a: { id: string }) => a.id)).toEqual([first.id])
    expect((await update).card.attachments).toHaveLength(1)

    expect(await filesOnDisk()).not.toContain(secondFile)
    expect((await request(app).get(first.url)).status).toBe(200)
    expect((await request(app).get(second.url)).status).toBe(404)

    const again = await request(app).delete(`${path}/${second.id}`).set(authed(member.accessToken))
    expect(again.status).toBe(404)
  })

  it('deleting a card also deletes its images from storage', async () => {
    const { member, path, card } = await setupCard()
    const { attachment } = (await upload(path, member.accessToken, PNG, 'gone.png', 'image/png')).body
    const file = attachment.url.replace('/uploads/', '')

    await boardService.deleteCard(card.id)
    await new Promise((r) => setTimeout(r, 50)) // cleanup is best-effort, fire-and-forget
    expect(await filesOnDisk()).not.toContain(file)
  })

  describe('permissions are enforced, not just declared', () => {
    it('rejects unauthenticated requests', async () => {
      const { path } = await setupCard()
      expect((await request(app).post(path).attach('file', PNG, 'x.png')).status).toBe(401)
    })

    it('rejects non-members (404) without storing anything', async () => {
      const { path } = await setupCard()
      const outsider = await registerUser('outsider@example.com')
      const before = await filesOnDisk()
      const res = await upload(path, outsider.accessToken, PNG, 'x.png', 'image/png')
      expect(res.status).toBe(404)
      expect(await filesOnDisk()).toEqual(before)
    })

    it('rejects unsubscribed orgs (402)', async () => {
      const { member, orgId, path } = await setupCard()
      await Subscription.updateOne({ orgId }, { status: 'canceled' })
      expect((await upload(path, member.accessToken, PNG, 'x.png', 'image/png')).status).toBe(402)
    })

    it("rejects reaching another org's card through your own org's route", async () => {
      const { card, member, path } = await setupCard()
      const { attachment } = (await upload(path, member.accessToken, PNG, 'x.png', 'image/png')).body

      // An unrelated user with their own subscribed org
      const attacker = await registerUser('attacker@example.com')
      const attackerOrg = await request(app).post('/orgs').set(authed(attacker.accessToken)).send({ name: 'Evil' })
      const attackerOrgId = attackerOrg.body.org.id as string
      await subscribe(attackerOrgId)
      const viaOwnOrg = `/orgs/${attackerOrgId}/board/cards/${card.id}/attachments`

      const uploadRes = await upload(viaOwnOrg, attacker.accessToken, PNG, 'x.png', 'image/png')
      expect(uploadRes.status).toBe(404)
      const deleteRes = await request(app).delete(`${viaOwnOrg}/${attachment.id}`).set(authed(attacker.accessToken))
      expect(deleteRes.status).toBe(404)
      expect((await Card.findById(card.id))!.attachments).toHaveLength(1)
    })
  })
})

describe('card checklists', () => {
  async function setupCard() {
    const { owner, member, orgId } = await setupSubscribedOrg()
    const state = await boardService.getBoardState(orgId)
    const card = await boardService.createCard(state.board.id, state.columns[0]!.id, 'Launch', owner.userId)
    const base = `/orgs/${orgId}/board/cards/${card.id}/checklists`
    return { owner, member, orgId, card, base }
  }

  const post = (path: string, token: string, body: object = {}) => request(app).post(path).set(authed(token)).send(body)
  const patch = (path: string, token: string, body: object) => request(app).patch(path).set(authed(token)).send(body)
  const del = (path: string, token: string) => request(app).delete(path).set(authed(token))

  async function checklistWithItems(base: string, token: string, texts: string[]) {
    const created = await post(base, token, { title: 'Launch steps' })
    const checklistId = created.body.card.checklists[0].id as string
    let card = created.body.card
    for (const text of texts) card = (await post(`${base}/${checklistId}/items`, token, { text })).body.card
    const itemIds = (card.checklists[0].items as { id: string }[]).map((i) => i.id)
    return { checklistId, itemIds, itemsPath: `${base}/${checklistId}/items` }
  }

  async function storedItem(cardId: string, itemId: string) {
    const card = await Card.findById(cardId)
    return card!.checklists.flatMap((c) => c.items).find((i) => i._id.toString() === itemId)!
  }

  it('creates checklists (default title "Checklist"), renames and deletes them', async () => {
    const { member, base } = await setupCard()

    const first = await post(base, member.accessToken)
    expect(first.status).toBe(201)
    expect(first.body.card.checklists).toEqual([{ id: expect.any(String), title: 'Checklist', items: [] }])

    const second = await post(base, member.accessToken, { title: '  Acceptance criteria  ' })
    expect(second.body.card.checklists.map((c: { title: string }) => c.title)).toEqual([
      'Checklist',
      'Acceptance criteria',
    ])

    const id = first.body.card.checklists[0].id
    const renamed = await patch(`${base}/${id}`, member.accessToken, { title: 'Subtasks' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.card.checklists[0].title).toBe('Subtasks')

    const deleted = await del(`${base}/${id}`, member.accessToken)
    expect(deleted.body.card.checklists.map((c: { title: string }) => c.title)).toEqual(['Acceptance criteria'])
    expect((await del(`${base}/${id}`, member.accessToken)).status).toBe(404)
  })

  it('deleting a checklist removes all of its items', async () => {
    const { member, base, card } = await setupCard()
    const { checklistId } = await checklistWithItems(base, member.accessToken, ['a', 'b', 'c'])
    await del(`${base}/${checklistId}`, member.accessToken)
    expect((await Card.findById(card.id))!.checklists).toHaveLength(0)
  })

  it('adds, renames and deletes items without touching the others', async () => {
    const { member, base } = await setupCard()
    const { itemIds, itemsPath } = await checklistWithItems(base, member.accessToken, ['Write copy', 'Ship'])

    const renamed = await patch(`${itemsPath}/${itemIds[0]}`, member.accessToken, { text: 'Write final copy' })
    expect(renamed.body.card.checklists[0].items.map((i: { text: string }) => i.text)).toEqual([
      'Write final copy',
      'Ship',
    ])

    const deleted = await del(`${itemsPath}/${itemIds[0]}`, member.accessToken)
    expect(deleted.body.card.checklists[0].items).toEqual([
      { id: itemIds[1], text: 'Ship', completed: false, completedBy: null, completedAt: null },
    ])
    expect((await del(`${itemsPath}/${itemIds[0]}`, member.accessToken)).status).toBe(404)
  })

  it('records who checked an item and when — from the auth token, never the body — and clears it on uncheck', async () => {
    const { owner, member, base, card } = await setupCard()
    const { itemIds, itemsPath } = await checklistWithItems(base, owner.accessToken, ['Review'])
    const itemPath = `${itemsPath}/${itemIds[0]}`

    const before = Date.now()
    // A forged completedBy in the body is ignored
    const checked = await patch(itemPath, member.accessToken, { completed: true, completedBy: owner.userId })
    expect(checked.status).toBe(200)
    let stored = await storedItem(card.id, itemIds[0]!)
    expect(stored.completed).toBe(true)
    expect(stored.completedBy!.toString()).toBe(member.userId)
    expect(stored.completedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
    const firstCheckedAt = stored.completedAt!.getTime()

    // Checking an already-checked item doesn't steal the credit or reset the time
    await patch(itemPath, owner.accessToken, { completed: true })
    stored = await storedItem(card.id, itemIds[0]!)
    expect(stored.completedBy!.toString()).toBe(member.userId)
    expect(stored.completedAt!.getTime()).toBe(firstCheckedAt)

    // Renaming a checked item leaves it checked
    await patch(itemPath, owner.accessToken, { text: 'Review PR' })
    stored = await storedItem(card.id, itemIds[0]!)
    expect(stored.text).toBe('Review PR')
    expect(stored.completed).toBe(true)

    const unchecked = await patch(itemPath, owner.accessToken, { completed: false })
    expect(unchecked.body.card.checklists[0].items[0]).toMatchObject({
      completed: false,
      completedBy: null,
      completedAt: null,
    })
    stored = await storedItem(card.id, itemIds[0]!)
    expect(stored.completedBy).toBeNull()
    expect(stored.completedAt).toBeNull()
  })

  it('concurrent toggles of different items both stick (atomic updates)', async () => {
    const { owner, member, base, card } = await setupCard()
    const { itemIds, itemsPath } = await checklistWithItems(base, owner.accessToken, ['a', 'b', 'c', 'd'])

    await Promise.all(
      itemIds.map((itemId, i) =>
        patch(`${itemsPath}/${itemId}`, i % 2 ? owner.accessToken : member.accessToken, { completed: true }),
      ),
    )
    const stored = (await Card.findById(card.id))!.checklists[0]!.items
    expect(stored.map((i) => i.completed)).toEqual([true, true, true, true])
  })

  it('validates input', async () => {
    const { member, base } = await setupCard()
    const { itemIds, itemsPath, checklistId } = await checklistWithItems(base, member.accessToken, ['a'])

    expect((await post(base, member.accessToken, { title: '   ' })).status).toBe(400)
    expect((await patch(`${base}/${checklistId}`, member.accessToken, {})).status).toBe(400)
    expect((await post(itemsPath, member.accessToken, { text: '' })).status).toBe(400)
    expect((await post(itemsPath, member.accessToken, { text: 'x'.repeat(501) })).status).toBe(400)
    expect((await patch(`${itemsPath}/${itemIds[0]}`, member.accessToken, {})).status).toBe(400)
    expect((await patch(`${itemsPath}/${itemIds[0]}`, member.accessToken, { completed: 'yes' })).status).toBe(400)
    expect((await post(`${base}/not-an-id/items`, member.accessToken, { text: 'x' })).status).toBe(404)
  })

  it('caps checklists per card', async () => {
    const { member, base } = await setupCard()
    for (let i = 0; i < 20; i++) expect((await post(base, member.accessToken)).status).toBe(201)
    const over = await post(base, member.accessToken)
    expect(over.status).toBe(409)
    expect(over.body.error).toMatch(/at most 20 checklists/)
  })

  it("broadcasts card:updated to the board, except the requester's own socket", async () => {
    const { owner, member, orgId, base } = await setupCard()
    const requester = await connect(member.accessToken)
    const viewer = await connect(owner.accessToken)
    await joinBoard(requester, orgId)
    await joinBoard(viewer, orgId)

    const viewerGetsIt = nextEvent(viewer, CARD_UPDATED)
    const requesterDoesNot = expectNoEvent(requester, CARD_UPDATED)
    await request(app)
      .post(base)
      .set(authed(member.accessToken))
      .set('X-Socket-Id', requester.id!)
      .send({ title: 'Live' })

    expect((await viewerGetsIt).card.checklists[0].title).toBe('Live')
    await requesterDoesNot
  })

  describe('permissions match every other card mutation', () => {
    it('rejects unauthenticated requests', async () => {
      const { base } = await setupCard()
      expect((await request(app).post(base).send({})).status).toBe(401)
    })

    it('rejects non-members with 404', async () => {
      const { owner, base } = await setupCard()
      const { itemIds, itemsPath } = await checklistWithItems(base, owner.accessToken, ['a'])
      const outsider = await registerUser('outsider@example.com')
      expect((await post(base, outsider.accessToken)).status).toBe(404)
      expect((await patch(`${itemsPath}/${itemIds[0]}`, outsider.accessToken, { completed: true })).status).toBe(404)
    })

    it('rejects unsubscribed orgs with 402', async () => {
      const { owner, orgId, base } = await setupCard()
      const { itemIds, itemsPath } = await checklistWithItems(base, owner.accessToken, ['a'])
      await Subscription.updateOne({ orgId }, { status: 'canceled' })
      expect((await post(base, owner.accessToken)).status).toBe(402)
      expect((await patch(`${itemsPath}/${itemIds[0]}`, owner.accessToken, { completed: true })).status).toBe(402)
    })

    it("rejects reaching another org's card through your own org's route", async () => {
      const { owner, card, base } = await setupCard()
      const { itemIds, checklistId } = await checklistWithItems(base, owner.accessToken, ['a'])
      const attacker = await registerUser('attacker@example.com')
      const attackerOrg = await request(app).post('/orgs').set(authed(attacker.accessToken)).send({ name: 'Evil' })
      await subscribe(attackerOrg.body.org.id)
      const via = `/orgs/${attackerOrg.body.org.id}/board/cards/${card.id}/checklists/${checklistId}`

      expect((await patch(`${via}/items/${itemIds[0]}`, attacker.accessToken, { completed: true })).status).toBe(404)
      expect((await del(via, attacker.accessToken)).status).toBe(404)
      expect((await Card.findById(card.id))!.checklists[0]!.items[0]!.completed).toBe(false)
    })
  })
})
