import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Long columns scroll inside themselves instead of stretching the page.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Scroll Org ${runId}`
const CARD_COUNT = 9

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

function column(page: Page, name: string) {
  return page.locator('.board-column', { has: page.getByRole('heading', { name, exact: true }) })
}

function list(page: Page, name: string) {
  return column(page, name).locator('.board-column-body')
}

function scrollState(page: Page, name: string) {
  return list(page, name).evaluate((el) => ({
    top: Math.round(el.scrollTop),
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }))
}

async function openBoard(page: Page, user: TestUser) {
  await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

test('long columns scroll on their own, and everything still lines up', async ({ browser }) => {
  const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const b = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)
  const title = (i: number) => `Task ${i} ${runId}`

  await test.step('adding many cards keeps the column short and scrolls to the new card', async () => {
    const todo = column(a, 'To Do')
    const pageHeight = () => a.evaluate(() => document.documentElement.scrollHeight)
    let heightAtCap = 0
    for (let i = 1; i <= CARD_COUNT; i++) {
      await todo.getByPlaceholder('Add a card...').fill(title(i))
      await todo.getByRole('button', { name: 'Add' }).click()
      await expect(todo.getByText(title(i))).toBeVisible()
      if (i === 6) heightAtCap = await pageHeight() // 6 cards already exceed the cap
    }
    await expect(b.getByText(title(CARD_COUNT))).toBeAttached()

    const state = await scrollState(a, 'To Do')
    expect(state.scrollHeight).toBeGreaterThan(state.clientHeight) // it scrolls...
    expect(state.clientHeight).toBeLessThanOrEqual(448) // ...within a capped height
    // Past the cap, more cards no longer make the page any taller
    expect(await pageHeight()).toBe(heightAtCap)

    // The card I just added was scrolled into view, with a hint that there's more above
    await expect(todo.getByText(title(CARD_COUNT))).toBeInViewport()
    await expect(todo.locator('.board-column-scroll')).toHaveClass(/more-above/)
    await expect(todo.locator('.board-column-scroll')).not.toHaveClass(/more-below/)
  })

  await test.step("the mouse wheel scrolls the list, not the page", async () => {
    const box = (await list(b, 'To Do').boundingBox())!
    await b.mouse.move(box.x + box.width / 2, box.y + 60)
    await b.mouse.wheel(0, 250)
    await expect.poll(async () => (await scrollState(b, 'To Do')).top).toBeGreaterThan(0)
    expect(await b.evaluate(() => window.scrollY)).toBe(0)
    await expect(column(b, 'To Do').locator('.board-column-scroll')).toHaveClass(/more-below/)
  })

  await test.step("cursors stay on the right card even when each viewer's list is scrolled differently", async () => {
    // A is scrolled to the bottom (auto-scroll); put B at the very top
    await list(b, 'To Do').evaluate((el) => (el.scrollTop = 0))
    const onA = (await column(a, 'To Do').getByText(title(CARD_COUNT)).boundingBox())!
    await a.mouse.move(onA.x + 25, onA.y + 8)

    // Once B scrolls to the same card, A's cursor is drawn right on it
    await list(b, 'To Do').evaluate((el) => (el.scrollTop = el.scrollHeight))
    const cursor = b.locator(`[data-cursor-user="${owner.name}"]`)
    await expect(cursor).toHaveAttribute('data-cursor-area', 'column')
    await expect
      .poll(async () => {
        const target = (await column(b, 'To Do').getByText(title(CARD_COUNT)).boundingBox())!
        const at = (await cursor.boundingBox())!
        return Math.max(Math.abs(at.x - (target.x + 25)), Math.abs(at.y - (target.y + 8)))
      })
      .toBeLessThanOrEqual(3)
  })

  await test.step('drag-and-drop still works out of a scrolled list', async () => {
    const last = column(a, 'To Do').locator('.board-card', { hasText: title(CARD_COUNT) })
    await last.dragTo(column(a, 'Done'))
    await expect(column(a, 'Done').getByText(title(CARD_COUNT))).toBeVisible()
    await expect(column(b, 'Done').getByText(title(CARD_COUNT))).toBeVisible()
  })

  await a.context().close()
  await b.context().close()
})
