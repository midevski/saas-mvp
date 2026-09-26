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
