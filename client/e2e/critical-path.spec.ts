import { expect, test, type Page } from '@playwright/test'
import { activateSubscription } from './support/db'

// The full journey in one test: signup -> org -> invite a second user -> subscribe ->
// both users on the realtime board, seeing each other's changes live over Socket.io.
// Emails are unique per run, so re-runs against the same database never collide.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const owner = { name: 'Alice Owner', email: `alice-${runId}@e2e.test`, password: 'password123' }
const teammate = { name: 'Bob Teammate', email: `bob-${runId}@e2e.test`, password: 'password123' }
const orgName = `E2E Org ${runId}`
const cardTitle = `Ship the demo ${runId}`

async function fillRegisterForm(page: Page, user: typeof owner) {
  await page.getByLabel('Name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

function column(page: Page, name: string) {
  return page.locator('.board-column', { has: page.getByRole('heading', { name, exact: true }) })
}

// A reload would wipe this marker — checking it afterwards proves an update arrived live
async function markPage(page: Page) {
  await page.evaluate(() => ((window as unknown as { __e2eNoReload: boolean }).__e2eNoReload = true))
}
async function expectNotReloaded(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __e2eNoReload?: boolean }).__e2eNoReload)).toBe(true)
}

test('signup -> org -> invite -> subscribe -> realtime board across two users', async ({ browser }) => {
  // Two isolated browser contexts = two separate users with separate sessions
  const ownerContext = await browser.newContext()
  const teammateContext = await browser.newContext()
  const a = await ownerContext.newPage()
  const b = await teammateContext.newPage()

  await test.step('owner registers and lands on the authenticated dashboard', async () => {
    await a.goto('/register')
    await fillRegisterForm(a, owner)
    await expect(a.getByRole('heading', { name: `Welcome, ${owner.name}` })).toBeVisible()
    await expect(a.getByRole('button', { name: 'Log out' })).toBeVisible()
  })

  await test.step('owner creates an org', async () => {
    await a.getByPlaceholder('Acme Inc.').fill(orgName)
    await a.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(a.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  })

  const boardHref = await a.getByRole('link', { name: 'Board', exact: true }).getAttribute('href')
  const orgId = boardHref!.match(/^\/orgs\/([a-f\d]{24})\/board$/)![1]!

  let invitePath = ''
  await test.step('owner generates an invite link', async () => {
    await a.getByRole('button', { name: 'Invite', exact: true }).click()
    const modal = a.getByRole('dialog', { name: 'Invite a teammate' })
    await modal.getByLabel('Email').fill(teammate.email)
    await modal.getByRole('button', { name: 'Create invite link' }).click()
    const link = await a.getByRole('dialog').getByLabel('Invite link').inputValue()
    invitePath = new URL(link).pathname
    expect(invitePath).toMatch(/^\/invites\/[a-f\d]+$/)
    await a.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  })

  await test.step('teammate opens the invite in another browser, registers, and joins', async () => {
    await b.goto(invitePath)
    // Not logged in yet: bounced to login, carrying the invite as the redirect target
    await expect(b).toHaveURL(/\/login\?redirect=/)
    await b.getByRole('link', { name: 'Create one' }).click()
    await fillRegisterForm(b, teammate)
    // Accepting the invite lands on the dashboard with the new org selected
    await expect(b.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  })

  await test.step('both users appear in the members list', async () => {
    await a.reload()
    for (const page of [a, b]) {
      const members = page.locator('section', { has: page.getByRole('heading', { name: 'Members' }) })
      await expect(members.getByText(owner.email)).toBeVisible()
      await expect(members.getByText(teammate.email)).toBeVisible()
    }
  })

  await test.step('org is subscribed', async () => {
    activateSubscription(orgId)
  })

  await test.step('both users open the realtime board', async () => {
    for (const page of [a, b]) {
      await page.getByRole('link', { name: 'Board', exact: true }).click()
      await expect(page).toHaveURL(`/orgs/${orgId}/board`)
      await expect(page.getByText('Live', { exact: true })).toBeVisible()
      await expect(column(page, 'To Do')).toBeVisible()
    }
  })

  await test.step('card created by the owner appears for the teammate without a reload', async () => {
    await markPage(b)
    const todo = column(a, 'To Do')
    await todo.getByPlaceholder('Add a card...').fill(cardTitle)
    await todo.getByRole('button', { name: 'Add' }).click()
    await expect(todo.getByText(cardTitle)).toBeVisible()

    await expect(column(b, 'To Do').getByText(cardTitle)).toBeVisible()
    await expectNotReloaded(b)
  })

  await test.step('card moved by the teammate moves for the owner without a reload', async () => {
    await markPage(a)
    const card = column(b, 'To Do').locator('.board-card', { hasText: cardTitle })
    await card.dragTo(column(b, 'In Progress'))
    await expect(column(b, 'In Progress').getByText(cardTitle)).toBeVisible()

    await expect(column(a, 'In Progress').getByText(cardTitle)).toBeVisible()
    await expect(column(a, 'To Do').getByText(cardTitle)).toHaveCount(0)
    await expectNotReloaded(a)
  })

  await test.step('the move was persisted, not just broadcast', async () => {
    await a.reload()
    await expect(column(a, 'In Progress').getByText(cardTitle)).toBeVisible()
    await expect(column(a, 'To Do').getByText(cardTitle)).toHaveCount(0)
  })

  await ownerContext.close()
  await teammateContext.close()
})
