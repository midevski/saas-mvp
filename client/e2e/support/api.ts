import type { APIRequestContext, Page } from '@playwright/test'

// Fast test setup through the real API (via the client's /api proxy), for state a spec
// needs but isn't itself testing — e.g. users and memberships before a UI check.

export interface TestUser {
  id: string
  name: string
  email: string
  password: string
  accessToken: string
}

export async function registerUser(request: APIRequestContext, name: string, email: string): Promise<TestUser> {
  const password = 'password123'
  const res = await request.post('/api/auth/register', { data: { name, email, password } })
  if (!res.ok()) throw new Error(`register ${email} failed: ${res.status()} ${await res.text()}`)
  const body = await res.json()
  return { id: body.user.id, name, email, password, accessToken: body.accessToken }
}

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.accessToken}` }
}

export async function createOrg(request: APIRequestContext, owner: TestUser, name: string): Promise<string> {
  const res = await request.post('/api/orgs', { data: { name }, headers: auth(owner) })
  if (!res.ok()) throw new Error(`create org failed: ${res.status()}`)
  return (await res.json()).org.id
}

export async function addMember(
  request: APIRequestContext,
  orgId: string,
  inviter: TestUser,
  invitee: TestUser,
  role: 'admin' | 'member',
) {
  const invite = await request.post(`/api/orgs/${orgId}/invites`, {
    data: { email: invitee.email, role },
    headers: auth(inviter),
  })
  if (!invite.ok()) throw new Error(`invite failed: ${invite.status()}`)
  const { inviteToken } = await invite.json()
  const accept = await request.post(`/api/invites/${inviteToken}/accept`, { headers: auth(invitee) })
  if (!accept.ok()) throw new Error(`accept failed: ${accept.status()}`)
}

export async function logIn(page: Page, user: TestUser) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('button', { name: 'Account menu' }).waitFor()
}
