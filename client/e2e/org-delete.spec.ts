import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription, detachStripeSubscription } from './support/db'

// Deleting an organization: owner only, confirmed by typing its name, and everyone in it is
// moved off its pages and told, live.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const doomedName = `Doomed Org ${runId}`
const keptName = `Kept Org ${runId}`

let owner: TestUser
let admin: TestUser
let member: TestUser
let doomedId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Dana Owner', `owner-${runId}@e2e.test`)
  admin = await registerUser(request, 'Ari Admin', `admin-${runId}@e2e.test`)
  member = await registerUser(request, 'Mo Member', `member-${runId}@e2e.test`)
  // Created first, so it's the org the dashboard opens on
  doomedId = await createOrg(request, owner, doomedName)
  await createOrg(request, owner, keptName)
  await addMember(request, doomedId, owner, admin, 'admin')
  await addMember(request, doomedId, owner, member, 'member')
  activateSubscription(doomedId)
  detachStripeSubscription(doomedId)
})

const dangerZone = (page: Page) => page.getByRole('region', { name: 'Delete this organization' })

test('admins and members never see the delete option', async ({ browser }) => {
  for (const user of [admin, member]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await logIn(page, user)
    await expect(page.getByRole('heading', { level: 1, name: doomedName })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(dangerZone(page)).toHaveCount(0)
    await context.close()
  }
})

test('the owner deletes the org after typing its name; a member on its board is moved off live', async ({
  browser,
}) => {
  const ownerContext = await browser.newContext()
  const memberContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  const memberPage = await memberContext.newPage()

  await test.step('a member has the board open', async () => {
    await logIn(memberPage, member)
    await memberPage.goto(`/orgs/${doomedId}/board`)
    await expect(memberPage.getByText('Live', { exact: true })).toBeVisible()
  })

  await logIn(ownerPage, owner)
  await expect(ownerPage.getByRole('heading', { level: 1, name: doomedName })).toBeVisible()
  const dialog = ownerPage.getByRole('dialog', { name: `Delete ${doomedName}?` })
  const confirm = dialog.getByRole('button', { name: 'Delete this organization' })

  await test.step('the dialog spells out the consequences; Cancel changes nothing', async () => {
    await dangerZone(ownerPage).getByRole('button', { name: 'Delete organization' }).click()
    await expect(dialog).toContainText('cannot be undone')
    await expect(dialog).toContainText('Every member loses access')
    await expect(dialog).toContainText('canceled right away')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
  })

  await test.step('the delete button unlocks only on the exact name', async () => {
    await dangerZone(ownerPage).getByRole('button', { name: 'Delete organization' }).click()
    // Reopening starts from an empty field
    await expect(dialog.getByLabel('Organization name')).toHaveValue('')
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Organization name').fill(doomedName.toLowerCase())
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel('Organization name').fill(doomedName)
    await expect(confirm).toBeEnabled()
  })

  await test.step('deleting lands the owner on their remaining org', async () => {
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    await expect(ownerPage.getByRole('heading', { level: 1, name: keptName })).toBeVisible()
    const switcher = ownerPage.getByRole('combobox', { name: 'Organization' })
    await expect(switcher.getByRole('option')).toHaveText([keptName])
  })

  await test.step('the member is taken off the board and told why, without reloading', async () => {
    await expect(memberPage).toHaveURL(/\/$/)
    await expect(memberPage.getByRole('status')).toContainText(`"${doomedName}" was deleted`)
    // They have no org left, so they're back to the getting-started view
    await expect(memberPage.getByRole('heading', { name: 'Create an organization' })).toBeVisible()
    await memberPage.getByRole('button', { name: 'Dismiss' }).click()
    await expect(memberPage.getByRole('status')).toHaveCount(0)
  })

  await test.step("the board's URL is dead afterwards", async () => {
    await memberPage.goto(`/orgs/${doomedId}/board`)
    await expect(memberPage.getByText('Live', { exact: true })).toHaveCount(0)
  })

  await ownerContext.close()
  await memberContext.close()
})
