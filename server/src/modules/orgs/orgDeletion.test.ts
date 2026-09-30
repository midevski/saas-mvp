import fs from 'fs/promises'
import http from 'http'
import type { AddressInfo } from 'net'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'

// Never hit the real Stripe API in tests
jest.mock('../../config/stripe', () => ({
  stripe: { subscriptions: { cancel: jest.fn() } },
}))

import { app } from '../../app'
import { stripe } from '../../config/stripe'
import { createSocketServer, type AppServer } from '../../realtime/socket'
import { BOARD_JOIN, ORG_DELETED } from '../../realtime/events'
import { Subscription } from '../billing/subscription.model'
import { Board } from '../board/board.model'
import { Card } from '../board/card.model'
import { Column } from '../board/column.model'
import * as boardService from '../board/board.service'
import { Invite } from './invite.model'
import { Membership } from './membership.model'
import { Org } from './org.model'

let mongod: MongoMemoryServer
let httpServer: http.Server
let io: AppServer
let baseUrl: string
const openSockets: ClientSocket[] = []
const cancel = stripe.subscriptions.cancel as jest.Mock
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

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
  cancel.mockReset()
  for (const socket of openSockets.splice(0)) socket.disconnect()
  for (const name of Object.keys(mongoose.connection.collections)) {
    await mongoose.connection.collections[name]!.deleteMany({})
  }
})

async function registerUser(email: string) {
  const res = await request(app).post('/auth/register').send({ email, password: 'password123', name: email })
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string, email }
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` })

async function createOrg(token: string, name = 'Acme') {
  return (await request(app).post('/orgs').set(authed(token)).send({ name })).body.org.id as string
}

async function addMember(orgId: string, ownerToken: string, user: { email: string; accessToken: string }, role: string) {
  const invite = await request(app).post(`/orgs/${orgId}/invites`).set(authed(ownerToken)).send({ email: user.email, role })
  await request(app).post(`/invites/${invite.body.inviteToken}/accept`).set(authed(user.accessToken))
}

// An org with an admin, a member, a pending invite, a board with a card + image, and a subscription
async function setupFullOrg() {
  const owner = await registerUser('owner@example.com')
  const admin = await registerUser('admin@example.com')
  const member = await registerUser('member@example.com')
  const orgId = await createOrg(owner.accessToken)
  await addMember(orgId, owner.accessToken, admin, 'admin')
  await addMember(orgId, owner.accessToken, member, 'member')
  await request(app).post(`/orgs/${orgId}/invites`).set(authed(owner.accessToken)).send({ email: 'pending@example.com', role: 'member' })
  await Subscription.create({ orgId, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' })

  const state = await boardService.getBoardState(orgId)
  const card = await boardService.createCard(state.board.id, state.columns[0]!.id, 'Task', owner.userId)
  const upload = await request(app)
    .post(`/orgs/${orgId}/board/cards/${card.id}/attachments`)
    .set(authed(owner.accessToken))
    .attach('file', PNG, { filename: 'pic.png', contentType: 'image/png' })
  const imageFile = (upload.body.attachment.url as string).replace('/uploads/', '')
  return { owner, admin, member, orgId, boardId: state.board.id, imageFile }
}

const deleteOrg = (orgId: string, token: string, confirmName: string | null = 'Acme') =>
  request(app).delete(`/orgs/${orgId}`).set(authed(token)).send(confirmName === null ? {} : { confirmName })

const uploadsOnDisk = () => fs.readdir(process.env.UPLOADS_DIR!).catch(() => [] as string[])

describe('DELETE /orgs/:orgId', () => {
  it('lets the owner delete the org and everything in it, leaving other orgs alone', async () => {
    const { owner, orgId, boardId, imageFile } = await setupFullOrg()
    const otherOrgId = await createOrg(owner.accessToken, 'Keep me')
    cancel.mockResolvedValue({ id: 'sub_1', status: 'canceled' })
    expect(await uploadsOnDisk()).toContain(imageFile)

    const res = await deleteOrg(orgId, owner.accessToken)
    expect(res.status).toBe(204)

    expect(await Org.exists({ _id: orgId })).toBeNull()
    expect(await Membership.countDocuments({ orgId })).toBe(0)
    expect(await Invite.countDocuments({ orgId })).toBe(0)
    expect(await Subscription.countDocuments({ orgId })).toBe(0)
    expect(await Board.countDocuments({ orgId })).toBe(0)
    expect(await Column.countDocuments({ boardId })).toBe(0)
    expect(await Card.countDocuments({ boardId })).toBe(0)
    await new Promise((r) => setTimeout(r, 50)) // image cleanup is best-effort, fire-and-forget
    expect(await uploadsOnDisk()).not.toContain(imageFile)

    // The owner's other org is untouched, and the deleted one is gone from their list
    expect(await Org.exists({ _id: otherOrgId })).not.toBeNull()
    const orgs = await request(app).get('/orgs').set(authed(owner.accessToken))
    expect(orgs.body.orgs.map((o: { name: string }) => o.name)).toEqual(['Keep me'])
  })

  it('cancels the Stripe subscription immediately', async () => {
    const { owner, orgId } = await setupFullOrg()
    cancel.mockResolvedValue({ id: 'sub_1', status: 'canceled' })
    await deleteOrg(orgId, owner.accessToken)
    expect(cancel).toHaveBeenCalledWith('sub_1')
  })

  it("deletes nothing if Stripe can't confirm the cancellation", async () => {
    const { owner, orgId, boardId } = await setupFullOrg()
    cancel.mockRejectedValue(Object.assign(new Error('Stripe is down'), { code: 'api_connection_error' }))

    const res = await deleteOrg(orgId, owner.accessToken)
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/nothing was deleted/)
    expect(await Org.exists({ _id: orgId })).not.toBeNull()
    expect(await Subscription.countDocuments({ orgId })).toBe(1)
    expect(await Card.countDocuments({ boardId })).toBe(1)
    expect(await Membership.countDocuments({ orgId })).toBe(3)
  })

  it('treats a subscription already gone on Stripe as fine', async () => {
    const { owner, orgId } = await setupFullOrg()
    cancel.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    expect((await deleteOrg(orgId, owner.accessToken)).status).toBe(204)
    expect(await Org.exists({ _id: orgId })).toBeNull()
  })

  it("doesn't call Stripe for an already-ended subscription, and works for unsubscribed orgs", async () => {
    const owner = await registerUser('owner@example.com')
    const endedOrg = await createOrg(owner.accessToken)
    await Subscription.create({ orgId: endedOrg, stripeCustomerId: 'c', stripeSubscriptionId: 'sub_x', status: 'canceled' })
    const neverPaidOrg = await createOrg(owner.accessToken)

    expect((await deleteOrg(endedOrg, owner.accessToken)).status).toBe(204)
    expect((await deleteOrg(neverPaidOrg, owner.accessToken)).status).toBe(204)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('requires typing the exact org name', async () => {
    const { owner, orgId } = await setupFullOrg()
    for (const confirmName of [null, '', 'acme', 'Acme Inc']) {
      const res = await deleteOrg(orgId, owner.accessToken, confirmName)
      expect(res.status).toBe(400)
    }
    expect(cancel).not.toHaveBeenCalled()
    expect(await Org.exists({ _id: orgId })).not.toBeNull()
  })

  it('is owner-only: admins and members get 403, outsiders 404, anonymous 401', async () => {
    const { admin, member, orgId } = await setupFullOrg()
    const outsider = await registerUser('outsider@example.com')
    expect((await deleteOrg(orgId, admin.accessToken)).status).toBe(403)
    expect((await deleteOrg(orgId, member.accessToken)).status).toBe(403)
    expect((await deleteOrg(orgId, outsider.accessToken)).status).toBe(404)
    expect((await request(app).delete(`/orgs/${orgId}`).send({ confirmName: 'Acme' })).status).toBe(401)
    expect(cancel).not.toHaveBeenCalled()
    expect(await Org.exists({ _id: orgId })).not.toBeNull()
  })

  it('tells every member right away — on the board or anywhere else in the app — but not outsiders', async () => {
    const { owner, admin, member, orgId } = await setupFullOrg()
    const outsider = await registerUser('outsider@example.com')
    cancel.mockResolvedValue({})

    const connect = async (token: string) => {
      const socket = ioClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false })
      openSockets.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve())
        socket.once('connect_error', reject)
      })
      return socket
    }
    const onBoard = await connect(member.accessToken) // viewing the board
    expect(await onBoard.timeout(2000).emitWithAck(BOARD_JOIN, { orgId })).toEqual({ ok: true })
    const elsewhere = await connect(admin.accessToken) // e.g. on the dashboard
    const stranger = await connect(outsider.accessToken)

    const events = { onBoard: [] as unknown[], elsewhere: [] as unknown[], stranger: [] as unknown[] }
    onBoard.on(ORG_DELETED, (p) => events.onBoard.push(p))
    elsewhere.on(ORG_DELETED, (p) => events.elsewhere.push(p))
    stranger.on(ORG_DELETED, (p) => events.stranger.push(p))

    await deleteOrg(orgId, owner.accessToken)
    await new Promise((r) => setTimeout(r, 200))

    expect(events.onBoard).toEqual([{ orgId, orgName: 'Acme' }]) // once, not twice
    expect(events.elsewhere).toEqual([{ orgId, orgName: 'Acme' }])
    expect(events.stranger).toEqual([])
  })
})
