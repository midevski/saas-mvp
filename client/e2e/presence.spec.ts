import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Board presence: who has this org's board open right now, shown top-right on the board page.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Presence Org ${runId}`

let owner: TestUser
let member: TestUser
let lurker: TestUser // org member who never opens the board
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  member = await registerUser(request, 'Max Member', `member-${runId}@e2e.test`)
  lurker = await registerUser(request, 'Lou Lurker', `lurker-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, orgName)
  await addMember(request, orgId, owner, member, 'member')
  await addMember(request, orgId, owner, lurker, 'member')
  activateSubscription(orgId)
})

function stack(page: Page) {
  return page.getByRole('button', { name: /viewing this board/ })
}

async function expectViewing(page: Page, count: number) {
  // Presence travels over the socket; a few seconds covers disconnect detection
  await expect(stack(page)).toHaveAccessibleName(`${count} viewing this board — show all members`, {
    timeout: 8_000,
  })
}

async function openBoard(context: BrowserContext, user?: TestUser) {
  const page = await context.newPage()
  if (user) await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  return page
}

async function membersPopover(page: Page) {
  await stack(page).click()
  const popover = page.getByRole('dialog', { name: 'Board members' })
  await expect(popover).toBeVisible()
  return {
    online: popover.getByRole('region', { name: 'Online' }),
    offline: popover.getByRole('region', { name: 'Offline' }),
    close: async () => {
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
    },
  }
}

test('board presence: join, popover, multiple tabs, leaving', async ({ browser }) => {
  const ownerContext = await browser.newContext()
  const memberContext = await browser.newContext()

  const ownerTab1 = await openBoard(ownerContext, owner)
  await expectViewing(ownerTab1, 1)

  await test.step('a second member appears in both stacks', async () => {
    const memberPage = await openBoard(memberContext, member)
    await expectViewing(memberPage, 2)
    await expectViewing(ownerTab1, 2)
  })
  const memberPage = memberContext.pages()[0]!

  await test.step('popover splits online vs offline and includes members who never opened the board', async () => {
    const { online, offline, close } = await membersPopover(ownerTab1)
    await expect(online.getByRole('listitem')).toHaveCount(2)
    await expect(online).toContainText('Olga Owner (you)')
    await expect(online).toContainText('Max Member')
    await expect(offline.getByRole('listitem')).toHaveCount(1)
    await expect(offline).toContainText('Lou Lurker')
    await close()
  })

  await test.step('a second tab of the same user is not double-counted, and closing one tab keeps them online', async () => {
    // Same browser context = same logged-in session, like a second tab
    const ownerTab2 = await openBoard(ownerContext)
    await expectViewing(ownerTab2, 2)
    await expectViewing(memberPage, 2)

    await ownerTab1.close()
    // Give the server time to process the disconnect, then confirm the owner is still online
    await memberPage.waitForTimeout(2_000)
    await expectViewing(memberPage, 2)
    const { online, close } = await membersPopover(memberPage)
    await expect(online).toContainText('Olga Owner')
    await close()
  })

  await test.step("closing the user's last tab takes them offline", async () => {
    await ownerContext.pages()[0]!.close()
    await expectViewing(memberPage, 1)
    const { offline, close } = await membersPopover(memberPage)
    await expect(offline).toContainText('Olga Owner')
    await expect(offline).toContainText('Lou Lurker')
    await close()
  })

  await test.step('navigating away from the board (socket stays connected) also counts as leaving', async () => {
    const ownerPage = await openBoard(ownerContext)
    await expectViewing(memberPage, 2)

    await ownerPage.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click()
    await expect(ownerPage.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
    await expectViewing(memberPage, 1)
    // Presence lives on the board page only, not the org page
    await expect(stack(ownerPage)).toHaveCount(0)
  })

  await ownerContext.close()
  await memberContext.close()
})
