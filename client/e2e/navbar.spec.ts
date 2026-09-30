import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// The navbar holds Invite, the board's "who's viewing" stack, and the account menu.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Navbar Org ${runId}`

let owner: TestUser
let member: TestUser
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  member = await registerUser(request, 'Max Member', `member-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, orgName)
  await addMember(request, orgId, owner, member, 'member')
  activateSubscription(orgId)
})

const navbar = (page: Page) => page.getByRole('banner')
const main = (page: Page) => page.getByRole('main')

test('Invite and presence live in the navbar, not the page', async ({ page }) => {
  await logIn(page, owner)
  await expect(main(page).getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await expect(navbar(page).getByRole('button', { name: 'Invite', exact: true })).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
  // Presence only exists on the board page
  await expect(navbar(page).getByRole('button', { name: /viewing this board/ })).toHaveCount(0)

  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect(navbar(page).getByRole('button', { name: '1 viewing this board — show all members' })).toBeVisible()
  await expect(main(page).getByRole('button', { name: /viewing this board/ })).toHaveCount(0)
  await expect(main(page).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)

  // The navbar's presence popover still works (it keeps the board's presence data)
  await navbar(page).getByRole('button', { name: /viewing this board/ }).click()
  await expect(page.getByRole('dialog', { name: 'Board members' })).toContainText('Olga Owner (you)')
  await page.keyboard.press('Escape')

  // Invite from the navbar on the board page targets this board's org
  await navbar(page).getByRole('button', { name: 'Invite', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Invite a teammate' }).getByText(orgName, { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

  // Leaving the board clears the presence stack from the navbar
  await navbar(page).getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click()
  await expect(navbar(page).getByRole('button', { name: /viewing this board/ })).toHaveCount(0)
})

test('members get no Invite button in the navbar', async ({ page }) => {
  await logIn(page, member)
  await expect(main(page).getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await expect(navbar(page).getByRole('button', { name: 'Invite', exact: true })).toHaveCount(0)
})

test('the avatar opens an account menu with who you are and Log out', async ({ page }) => {
  await logIn(page, owner)
  // No email printed in the navbar anymore — just the avatar
  await expect(navbar(page).getByText(owner.email)).toHaveCount(0)

  const button = navbar(page).getByRole('button', { name: 'Account menu' })
  await expect(button).toContainText('OO') // initials avatar
  await button.click()
  const menu = page.getByRole('menu', { name: 'Account' })
  await expect(menu).toContainText('Olga Owner')
  await expect(menu).toContainText(owner.email)
  await expect(button).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape') // closes
  await expect(menu).toHaveCount(0)
  await button.click()
  await main(page).click({ position: { x: 5, y: 5 } }) // clicking elsewhere closes
  await expect(menu).toHaveCount(0)

  await button.click()
  await menu.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  // Really logged out: protected pages bounce back to login
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})
