import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'

// Never hit the real Stripe API in tests — mock the SDK client instance
jest.mock('../../config/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: jest.fn() },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: { retrieve: jest.fn() },
  },
}))

import { app } from '../../app'
import { stripe } from '../../config/stripe'
import { Subscription } from './subscription.model'
import * as billingService from './billing.service'

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
  jest.clearAllMocks()
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

function postWebhook(rawBody: string, signature?: string) {
  const req = request(app).post('/billing/webhook').set('Content-Type', 'application/json')
  if (signature) req.set('stripe-signature', signature)
  return req.send(rawBody)
}

describe('GET /billing/config', () => {
  it('exposes the configured Pro price id to authenticated clients', async () => {
    const user = await registerUser('configcheck@example.com')
    const res = await request(app).get('/billing/config').set(authed(user.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.proPriceId).toBe(process.env.STRIPE_PRICE_ID_PRO)
  })

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/billing/config')
    expect(res.status).toBe(401)
  })
})

describe('POST /billing/webhook', () => {
  it('rejects a request with no signature header', async () => {
    const res = await postWebhook(JSON.stringify({ type: 'checkout.session.completed' }))
    expect(res.status).toBe(400)
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
  })

  it('rejects a tampered/unverifiable payload', async () => {
    ;(stripe.webhooks.constructEvent as jest.Mock).mockImplementation(() => {
      throw new Error('signature mismatch')
    })

    const res = await postWebhook(JSON.stringify({ type: 'checkout.session.completed' }), 'bad-sig')
    expect(res.status).toBe(400)
  })

  it('sets the org subscription to active on checkout.session.completed', async () => {
    const owner = await registerUser('checkoutcomplete@example.com')
    const orgId = await createOrg(owner.accessToken)

    ;(stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { orgId },
        },
      },
    })
    ;(stripe.subscriptions.retrieve as jest.Mock).mockResolvedValue({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      items: {
        data: [
          {
            price: { id: 'price_pro' },
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          },
        ],
      },
    })

    const res = await postWebhook(JSON.stringify({}), 'valid-sig')
    expect(res.status).toBe(200)

    const stored = await Subscription.findOne({ orgId })
    expect(stored?.status).toBe('active')
    expect(stored?.priceId).toBe('price_pro')
    expect(stored?.stripeSubscriptionId).toBe('sub_123')
    expect(await billingService.isOrgSubscribed(orgId)).toBe(true)
  })

  it('flips status to canceled on customer.subscription.deleted', async () => {
    const owner = await registerUser('subdeleted@example.com')
    const orgId = await createOrg(owner.accessToken)
    await Subscription.create({ orgId, stripeCustomerId: 'cus_456', status: 'active' })

    ;(stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_456' } },
    })

    const res = await postWebhook(JSON.stringify({}), 'valid-sig')
    expect(res.status).toBe(200)

    const stored = await Subscription.findOne({ orgId })
    expect(stored?.status).toBe('canceled')
  })
})

describe('isOrgSubscribed', () => {
  it('returns false when there is no subscription record at all', async () => {
    const owner = await registerUser('nosub@example.com')
    const orgId = await createOrg(owner.accessToken)
    expect(await billingService.isOrgSubscribed(orgId)).toBe(false)
  })

  it.each([
    ['active', true],
    ['trialing', true],
    ['past_due', false],
    ['canceled', false],
  ] as const)('status %s -> subscribed %s', async (status, expected) => {
    const owner = await registerUser(`status-${status}@example.com`)
    const orgId = await createOrg(owner.accessToken)
    await Subscription.create({ orgId, stripeCustomerId: 'cus_x', status })

    expect(await billingService.isOrgSubscribed(orgId)).toBe(expected)
  })
})

describe('billing role gating', () => {
  it('lets only the owner initiate checkout or open the portal', async () => {
    const owner = await registerUser('owner2@example.com')
    const member = await registerUser('member2@example.com')
    const orgId = await createOrg(owner.accessToken)

    const inviteRes = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(owner.accessToken))
      .send({ email: member.email, role: 'member' })
    await request(app)
      .post(`/invites/${inviteRes.body.inviteToken}/accept`)
      .set(authed(member.accessToken))

    const checkoutAsMember = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .set(authed(member.accessToken))
      .send({ priceId: 'price_pro' })
    expect(checkoutAsMember.status).toBe(403)

    const portalAsMember = await request(app)
      .post(`/orgs/${orgId}/billing/portal`)
      .set(authed(member.accessToken))
    expect(portalAsMember.status).toBe(403)

    ;(stripe.customers.create as jest.Mock).mockResolvedValue({ id: 'cus_owner' })
    ;(stripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
      url: 'https://checkout.stripe.com/test-session',
    })

    const checkoutAsOwner = await request(app)
      .post(`/orgs/${orgId}/billing/checkout`)
      .set(authed(owner.accessToken))
      .send({ priceId: 'price_pro' })
    expect(checkoutAsOwner.status).toBe(200)
    expect(checkoutAsOwner.body.url).toBe('https://checkout.stripe.com/test-session')
  })
})

describe('GET /orgs/:orgId/billing/status', () => {
  it('reflects the cached subscription state', async () => {
    const owner = await registerUser('statuscheck@example.com')
    const orgId = await createOrg(owner.accessToken)

    const beforeRes = await request(app)
      .get(`/orgs/${orgId}/billing/status`)
      .set(authed(owner.accessToken))
    expect(beforeRes.body).toEqual({
      subscribed: false,
      status: null,
      priceId: null,
      currentPeriodEnd: null,
    })

    await Subscription.create({ orgId, stripeCustomerId: 'cus_z', status: 'active', priceId: 'price_pro' })

    const afterRes = await request(app)
      .get(`/orgs/${orgId}/billing/status`)
      .set(authed(owner.accessToken))
    expect(afterRes.body.subscribed).toBe(true)
    expect(afterRes.body.status).toBe('active')
  })
})

describe('requireSubscription', () => {
  it('blocks with 402 when unsubscribed and allows access once subscribed', async () => {
    const owner = await registerUser('gate@example.com')
    const orgId = await createOrg(owner.accessToken)

    const blockedRes = await request(app)
      .get(`/orgs/${orgId}/premium-placeholder`)
      .set(authed(owner.accessToken))
    expect(blockedRes.status).toBe(402)

    await Subscription.create({ orgId, stripeCustomerId: 'cus_gate', status: 'active' })

    const allowedRes = await request(app)
      .get(`/orgs/${orgId}/premium-placeholder`)
      .set(authed(owner.accessToken))
    expect(allowedRes.status).toBe(200)
  })
})
