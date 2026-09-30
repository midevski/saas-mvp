import { expect, test, type Browser, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'

// Invite UX by role: owner and admin can invite via the modal and copy the link, members
// can't see it at all, and a copied link still completes the accept flow end to end.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Invite Org ${runId}`
const newcomerEmail = `newcomer-${runId}@e2e.test`
const secondNewcomerEmail = `newcomer2-${runId}@e2e.test`

let owner: TestUser
let admin: TestUser
let member: TestUser
let ownerInviteLink = ''
let orgId = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olivia Owner', `owner-${runId}@e2e.test`)
  admin = await registerUser(request, 'Adam Admin', `admin-${runId}@e2e.test`)
  member = await registerUser(request, 'Mia Member', `member-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, orgName)
  await addMember(request, orgId, owner, admin, 'admin')
  await addMember(request, orgId, owner, member, 'member')
})

async function signedInPage(browser: Browser, user: TestUser): Promise<Page> {
  // Clipboard permissions let the test read back what "Copy link" actually copied
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  await logIn(page, user)
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  return page
}

function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

function inviteRequests(page: Page) {
  const sent: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/orgs\/[^/]+\/invites$/.test(req.url())) sent.push(req.url())
  })
  return sent
}

async function createInvite(page: Page, email: string, role: 'Member' | 'Admin') {
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Email').fill(email)
  await modal.getByRole('radio', { name: new RegExp(`^${role}`) }).check()
  await modal.getByRole('button', { name: 'Create invite link' }).click()
  await expect(modal.getByRole('heading', { name: 'Invite link ready' })).toBeVisible()
  return modal.getByLabel('Invite link').inputValue()
}

function pendingInvites(page: Page) {
  return page.getByRole('region', { name: 'Pending invites' })
}

test('owner: invite button -> modal -> validation -> invite -> copy link', async ({ browser }) => {
  const page = await signedInPage(browser, owner)
  const sent = inviteRequests(page)

  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Invite a teammate' })
  await expect(modal).toBeVisible()
  // Owner is never offered as an invite role
  await expect(modal.getByRole('radio')).toHaveCount(2)

  await test.step('invalid email is caught inline, without calling the server', async () => {
    await modal.getByLabel('Email').fill('not-an-email')
    await modal.getByRole('button', { name: 'Create invite link' }).click()
    await expect(modal.getByText('Enter a valid email address, like name@company.com.')).toBeVisible()
    await expect(modal.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(sent).toHaveLength(0)
  })

  await test.step('existing member shows a clear server error', async () => {
    await modal.getByLabel('Email').fill(member.email)
    await modal.getByRole('button', { name: 'Create invite link' }).click()
    await expect(modal.getByRole('alert')).toHaveText(`${member.email} is already a member of this organization.`)
    expect(sent).toHaveLength(1)
  })

  await test.step('valid invite shows the link and copies it', async () => {
    ownerInviteLink = await createInvite(page, newcomerEmail, 'Admin')
    expect(ownerInviteLink).toMatch(/\/invites\/[a-f\d]+$/)
    await expect(page.getByRole('dialog').getByText(`Invite created for ${newcomerEmail} as an admin.`)).toBeVisible()

    await page.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Copied!' })).toBeVisible()
    expect(await readClipboard(page)).toBe(ownerInviteLink)
  })

  await test.step('modal stays open until dismissed, then the pending list shows the invite', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const row = pendingInvites(page).getByRole('listitem').filter({ hasText: newcomerEmail })
    await expect(row).toContainText('admin · expires in 7 days')

    // Re-copy from the list, as if the link had been lost
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await row.getByRole('button', { name: 'Copy link' }).click()
    await expect(row.getByRole('button', { name: 'Copied!' })).toBeVisible()
    expect(await readClipboard(page)).toBe(ownerInviteLink)
  })

  await page.context().close()
})

test('admin: sees the same invite button and completes the same flow', async ({ browser }) => {
  const page = await signedInPage(browser, admin)

  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const link = await createInvite(page, secondNewcomerEmail, 'Member')

  await page.getByRole('dialog').getByRole('button', { name: 'Copy link' }).click()
  expect(await readClipboard(page)).toBe(link)
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // Admins can see (and manage) all of the org's pending invites, including the owner's
  await expect(pendingInvites(page).getByText(newcomerEmail)).toBeVisible()
  await expect(pendingInvites(page).getByText(secondNewcomerEmail)).toBeVisible()

  await test.step('admin can revoke a pending invite', async () => {
    const row = pendingInvites(page).getByRole('listitem').filter({ hasText: secondNewcomerEmail })
    await row.getByRole('button', { name: 'Revoke' }).click()
    await row.getByRole('button', { name: 'Confirm revoke' }).click()
    await expect(pendingInvites(page).getByText(secondNewcomerEmail)).toHaveCount(0)
  })

  await test.step('the invite button is on the board page too, scoped to that org', async () => {
    await page.goto(`/orgs/${orgId}/board`)
    await expect(page.getByText('Realtime board', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Invite', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Invite a teammate' })
    await expect(modal.getByText(orgName, { exact: true })).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  await page.context().close()
})

test('member: no invite button and no pending invites', async ({ browser }) => {
  const page = await signedInPage(browser, member)

  // The members list rendering proves the dashboard has fully loaded before asserting absence
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0)

  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Realtime board', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)

  await page.context().close()
})

test('a copied invite link completes the accept flow in a fresh session', async ({ browser }) => {
  expect(ownerInviteLink).not.toBe('')
  const context = await browser.newContext() // logged out, like an incognito window
  const page = await context.newPage()

  await page.goto(new URL(ownerInviteLink).pathname)
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByRole('link', { name: 'Create one' }).click()
  await page.getByLabel('Name').fill('Nora Newcomer')
  await page.getByLabel('Email').fill(newcomerEmail)
  await page.getByLabel('Password', { exact: true }).fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Joined as the invited role, with the org selected
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await expect(page.locator('.page-header .pill')).toHaveText('admin')
  const members = page.locator('section', { has: page.getByRole('heading', { name: 'Members' }) })
  await expect(members.getByText(newcomerEmail)).toBeVisible()

  await context.close()
})
