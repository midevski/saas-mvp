import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { app } from '../../app'
import { Invite } from './invite.model'

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

async function registerUser(email: string) {
  const res = await request(app)
    .post('/auth/register')
    .send({ email, password: 'password123', name: email.split('@')[0] })
  return { accessToken: res.body.accessToken as string, userId: res.body.user.id as string, email }
}

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` }
}

async function createOrg(ownerToken: string, name = 'Acme Inc') {
  const res = await request(app).post('/orgs').set(authed(ownerToken)).send({ name })
  return res.body.org.id as string
}

async function inviteAndAccept(
  orgId: string,
  inviterToken: string,
  invitee: { email: string; accessToken: string },
  role: 'admin' | 'member',
) {
  const inviteRes = await request(app)
    .post(`/orgs/${orgId}/invites`)
    .set(authed(inviterToken))
    .send({ email: invitee.email, role })
  await request(app)
    .post(`/invites/${inviteRes.body.inviteToken}/accept`)
    .set(authed(invitee.accessToken))
  return inviteRes.body
}

describe('POST /orgs', () => {
  it('makes the creator the owner', async () => {
    const owner = await registerUser('owner@example.com')
    const res = await request(app).post('/orgs').set(authed(owner.accessToken)).send({ name: 'Acme Inc' })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe('owner')
    expect(res.body.org.slug).toEqual(expect.any(String))
  })
})

describe('org-scoped route access', () => {
  it('returns 404, not 403, for a user with no membership', async () => {
    const owner = await registerUser('owner2@example.com')
    const outsider = await registerUser('outsider@example.com')
    const orgId = await createOrg(owner.accessToken)

    const res = await request(app).get(`/orgs/${orgId}/members`).set(authed(outsider.accessToken))
    expect(res.status).toBe(404)
  })

  it('lets a member view members but not invite others', async () => {
    const owner = await registerUser('owner3@example.com')
    const member = await registerUser('member3@example.com')
    const orgId = await createOrg(owner.accessToken)
    await inviteAndAccept(orgId, owner.accessToken, member, 'member')

    const viewRes = await request(app).get(`/orgs/${orgId}/members`).set(authed(member.accessToken))
    expect(viewRes.status).toBe(200)
    expect(viewRes.body.members).toHaveLength(2)

    const inviteAttempt = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(member.accessToken))
      .send({ email: 'someone@example.com', role: 'member' })
    expect(inviteAttempt.status).toBe(403)
  })
})

describe('admin permissions', () => {
  it('can invite and remove a member, but not another admin', async () => {
    const owner = await registerUser('owner4@example.com')
    const admin = await registerUser('admin4@example.com')
    const member = await registerUser('member4@example.com')
    const admin2 = await registerUser('admin4b@example.com')
    const orgId = await createOrg(owner.accessToken)

    await inviteAndAccept(orgId, owner.accessToken, admin, 'admin')
    await inviteAndAccept(orgId, owner.accessToken, member, 'member')
    await inviteAndAccept(orgId, owner.accessToken, admin2, 'admin')

    const inviteByAdminRes = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(admin.accessToken))
      .send({ email: 'newperson@example.com', role: 'member' })
    expect(inviteByAdminRes.status).toBe(201)

    const removeMemberRes = await request(app)
      .delete(`/orgs/${orgId}/members/${member.userId}`)
      .set(authed(admin.accessToken))
    expect(removeMemberRes.status).toBe(204)

    const removeAdminRes = await request(app)
      .delete(`/orgs/${orgId}/members/${admin2.userId}`)
      .set(authed(admin.accessToken))
    expect(removeAdminRes.status).toBe(403)
  })
})

describe('owner permissions', () => {
  it('can remove an admin but never the owner', async () => {
    const owner = await registerUser('owner5@example.com')
    const admin = await registerUser('admin5@example.com')
    const orgId = await createOrg(owner.accessToken)
    await inviteAndAccept(orgId, owner.accessToken, admin, 'admin')

    const removeAdminRes = await request(app)
      .delete(`/orgs/${orgId}/members/${admin.userId}`)
      .set(authed(owner.accessToken))
    expect(removeAdminRes.status).toBe(204)

    const removeOwnerRes = await request(app)
      .delete(`/orgs/${orgId}/members/${owner.userId}`)
      .set(authed(owner.accessToken))
    expect(removeOwnerRes.status).toBe(403)
  })

  it('is the only role that can change a member role, and cannot demote itself', async () => {
    const owner = await registerUser('owner5b@example.com')
    const admin = await registerUser('admin5b@example.com')
    const member = await registerUser('member5b@example.com')
    const orgId = await createOrg(owner.accessToken)
    await inviteAndAccept(orgId, owner.accessToken, admin, 'admin')
    await inviteAndAccept(orgId, owner.accessToken, member, 'member')

    const adminTriesRes = await request(app)
      .patch(`/orgs/${orgId}/members/${member.userId}`)
      .set(authed(admin.accessToken))
      .send({ role: 'admin' })
    expect(adminTriesRes.status).toBe(403)

    const promoteRes = await request(app)
      .patch(`/orgs/${orgId}/members/${member.userId}`)
      .set(authed(owner.accessToken))
      .send({ role: 'admin' })
    expect(promoteRes.status).toBe(200)
    expect(promoteRes.body.role).toBe('admin')

    const selfDemoteRes = await request(app)
      .patch(`/orgs/${orgId}/members/${owner.userId}`)
      .set(authed(owner.accessToken))
      .send({ role: 'admin' })
    expect(selfDemoteRes.status).toBe(403)
  })
})

describe('invite acceptance', () => {
  it('rejects acceptance by the wrong email', async () => {
    const owner = await registerUser('owner6@example.com')
    const invited = await registerUser('invited6@example.com')
    const wrongUser = await registerUser('wrong6@example.com')
    const orgId = await createOrg(owner.accessToken)

    const inviteRes = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(owner.accessToken))
      .send({ email: invited.email, role: 'member' })

    const res = await request(app)
      .post(`/invites/${inviteRes.body.inviteToken}/accept`)
      .set(authed(wrongUser.accessToken))
    expect(res.status).toBe(403)
  })

  it('rejects an expired invite', async () => {
    const owner = await registerUser('owner7@example.com')
    const invited = await registerUser('invited7@example.com')
    const orgId = await createOrg(owner.accessToken)

    const inviteRes = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(owner.accessToken))
      .send({ email: invited.email, role: 'member' })

    await Invite.updateOne(
      { token: inviteRes.body.inviteToken },
      { expiresAt: new Date(Date.now() - 1000) },
    )

    const res = await request(app)
      .post(`/invites/${inviteRes.body.inviteToken}/accept`)
      .set(authed(invited.accessToken))
    expect(res.status).toBe(403)
  })

  it('rejects inviting someone who is already a member', async () => {
    const owner = await registerUser('owner8@example.com')
    const invited = await registerUser('invited8@example.com')
    const orgId = await createOrg(owner.accessToken)
    await inviteAndAccept(orgId, owner.accessToken, invited, 'member')

    const secondInviteRes = await request(app)
      .post(`/orgs/${orgId}/invites`)
      .set(authed(owner.accessToken))
      .send({ email: invited.email, role: 'member' })
    expect(secondInviteRes.status).toBe(409)
  })
})

describe('multi-org membership', () => {
  it('lets a user belong to multiple orgs with different roles', async () => {
    const user = await registerUser('multi@example.com')
    const other = await registerUser('other@example.com')

    await createOrg(user.accessToken, 'Org One')
    const org2Id = await createOrg(other.accessToken, 'Org Two')
    await inviteAndAccept(org2Id, other.accessToken, user, 'member')

    const listRes = await request(app).get('/orgs').set(authed(user.accessToken))
    expect(listRes.status).toBe(200)
    expect(listRes.body.orgs).toHaveLength(2)

    const roles = listRes.body.orgs.map((o: { role: string }) => o.role).sort()
    expect(roles).toEqual(['member', 'owner'])
  })
})
