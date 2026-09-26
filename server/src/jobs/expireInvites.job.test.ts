import crypto from 'crypto'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Invite, type InviteStatus } from '../modules/orgs/invite.model'
import { expireInvites } from './expireInvites.job'

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
  await Invite.deleteMany({})
})

const HOUR = 60 * 60 * 1000

function seedInvite(email: string, status: InviteStatus, expiresInMs: number) {
  return Invite.create({
    orgId: new mongoose.Types.ObjectId(),
    email,
    role: 'member',
    token: crypto.randomBytes(16).toString('hex'),
    expiresAt: new Date(Date.now() + expiresInMs),
    status,
    invitedBy: new mongoose.Types.ObjectId(),
  })
}

async function statusOf(email: string) {
  return (await Invite.findOne({ email }))!.status
}

describe('expireInvites', () => {
  it('flips only expired, still-pending invites to expired', async () => {
    await seedInvite('stale@example.com', 'pending', -HOUR)
    await seedInvite('stale2@example.com', 'pending', -24 * HOUR)
    await seedInvite('fresh@example.com', 'pending', HOUR)
    await seedInvite('accepted-old@example.com', 'accepted', -HOUR)
    await seedInvite('accepted-new@example.com', 'accepted', HOUR)

    const result = await expireInvites()

    expect(result).toEqual({ expiredCount: 2 })
    expect(await statusOf('stale@example.com')).toBe('expired')
    expect(await statusOf('stale2@example.com')).toBe('expired')
    expect(await statusOf('fresh@example.com')).toBe('pending')
    expect(await statusOf('accepted-old@example.com')).toBe('accepted')
    expect(await statusOf('accepted-new@example.com')).toBe('accepted')
  })

  it('does not count already-expired invites again', async () => {
    await seedInvite('done@example.com', 'expired', -HOUR)

    expect(await expireInvites()).toEqual({ expiredCount: 0 })
    expect(await statusOf('done@example.com')).toBe('expired')
  })

  it('is a no-op when nothing is stale', async () => {
    await seedInvite('fresh@example.com', 'pending', HOUR)
    expect(await expireInvites()).toEqual({ expiredCount: 0 })
  })

  it('logs how many invites it updated', async () => {
    await seedInvite('stale@example.com', 'pending', -HOUR)
    const log = jest.fn()

    await expireInvites(log)

    expect(log).toHaveBeenCalledWith('marked 1 stale invite(s) as expired')
  })
})
