import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Live cursors between two users with different window sizes, one of them with a
// horizontally scrolled board.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Cursor Org ${runId}`
const cardTitle = `Drag me ${runId}`

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

function cursorOf(page: Page, user: TestUser) {
  return page.locator(`[data-cursor-user="${user.name}"]`)
}

// Viewport position of an element's center on this page
async function centerOf(page: Page, name: string) {
  const box = (await column(page, name).getByRole('heading', { name, exact: true }).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Where a remote cursor is actually drawn right now (viewport coordinates of its tip)
async function drawnAt(page: Page, user: TestUser) {
  const box = await cursorOf(page, user).boundingBox()
  return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null
}

// The remote cursor visually lands on the same board element the other user is pointing at
async function expectCursorOver(viewer: Page, user: TestUser, target: { x: number; y: number }) {
  await expect
    .poll(async () => {
      const at = await drawnAt(viewer, user)
      return at ? Math.max(Math.abs(at.x - target.x), Math.abs(at.y - target.y)) : Infinity
    }, { timeout: 5_000 })
    .toBeLessThanOrEqual(3)
}

async function openBoard(page: Page, user: TestUser) {
  await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

async function expectBothOnline(page: Page) {
  await expect(page.getByRole('button', { name: '2 viewing this board — show all members' })).toBeVisible({
    timeout: 10_000,
  })
}

test('live cursors: labeled, aligned across window sizes and scroll, throttled, non-blocking', async ({
  browser,
}) => {
  const wide = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  // Narrow enough that the three columns overflow and the board scrolls horizontally
  const narrow = await (await browser.newContext({ viewport: { width: 820, height: 900 } })).newPage()

  // Count outgoing cursor frames from the wide page (throttle check)
  let cursorFramesSent = 0
  wide.on('websocket', (ws) =>
    ws.on('framesent', (frame) => {
      if (String(frame.payload).includes('cursor:move')) cursorFramesSent++
    }),
  )

  const pageA = wide
  const pageB = narrow
  await openBoard(pageA, owner)
  await openBoard(pageB, member)
  await expectBothOnline(pageA)
  await expectBothOnline(pageB)

  await test.step("each user sees the other's labeled, colored cursor", async () => {
    const target = await centerOf(pageA, 'In Progress')
    await pageA.mouse.move(target.x, target.y)
    await expect(cursorOf(pageB, owner)).toBeVisible()
    await expect(cursorOf(pageB, owner)).toContainText('Olga')
    await expectCursorOver(pageB, owner, await centerOf(pageB, 'In Progress'))

    const back = await centerOf(pageB, 'To Do')
    await pageB.mouse.move(back.x, back.y)
    await expect(cursorOf(pageA, member)).toContainText('Max')
    await expectCursorOver(pageA, member, await centerOf(pageA, 'To Do'))
  })

  await test.step('positions line up across different window sizes and a scrolled board', async () => {
    // Scroll the narrow window's board so "Done" is in a different place than for the wide window
    await pageB.locator('.board').evaluate((el) => (el.scrollLeft = el.scrollWidth))
    const doneOnA = await centerOf(pageA, 'Done')
    await pageA.mouse.move(doneOnA.x, doneOnA.y)
    // On B the cursor must sit on B's "Done" heading, wherever B's scroll put it
    await expectCursorOver(pageB, owner, await centerOf(pageB, 'Done'))
  })

  await test.step('cursors also show outside the board, unaffected by board scrolling', async () => {
    // B's board is still scrolled to the far end from the previous step
    const titleSpot = async (page: Page) => {
      const box = (await page.getByRole('heading', { level: 1, name: orgName }).boundingBox())!
      return { x: Math.round(box.x + 30), y: Math.round(box.y + 12) }
    }
    const onA = await titleSpot(pageA)
    await pageA.mouse.move(onA.x, onA.y)
    await expect(cursorOf(pageB, owner)).toHaveAttribute('data-cursor-area', 'page')
    await expectCursorOver(pageB, owner, await titleSpot(pageB))

    // And back onto the board: it switches to board coordinates again
    const doneOnA = await centerOf(pageA, 'Done')
    await pageA.mouse.move(doneOnA.x, doneOnA.y)
    await expect(cursorOf(pageB, owner)).toHaveAttribute('data-cursor-area', 'board')
    await expectCursorOver(pageB, owner, await centerOf(pageB, 'Done'))
  })

  await test.step('crossing between the page, the board and a card list stays smooth (no jump)', async () => {
    // Regression: cursors used to be re-created when switching coordinate areas, which made
    // them snap 60-350px in one frame right at the card-list edge
    await pageB.locator('.board').evaluate((el) => (el.scrollLeft = 0))
    const list = (await column(pageA, 'To Do').locator('.board-column-body').boundingBox())!
    const x = list.x + 120
    await pageA.mouse.move(x, list.y - 180)
    await expect(cursorOf(pageB, owner)).toHaveAttribute('data-cursor-area', 'page')

    await pageB.evaluate(() => {
      const w = window as unknown as { __samples: { y: number; area: string }[] }
      w.__samples = []
      const loop = () => {
        const el = document.querySelector<HTMLElement>('[data-cursor-user="Olga Owner"]')
        if (el) w.__samples.push({ y: el.getBoundingClientRect().top, area: el.dataset.cursorArea ?? '' })
        if (w.__samples.length < 600) requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    for (let i = 0; i < 2; i++) {
      await pageA.mouse.move(x, list.y + 60, { steps: 60 })
      await pageA.mouse.move(x, list.y - 180, { steps: 60 })
    }
    await pageA.waitForTimeout(200)

    const samples = await pageB.evaluate(
      () => (window as unknown as { __samples: { y: number; area: string }[] }).__samples,
    )
    const areasSeen = new Set(samples.map((s) => s.area))
    expect([...areasSeen].sort()).toEqual(['board', 'column', 'page'])
    // How far the drawn cursor moved in the single frame where its area switched
    const jumpsAtSwitches: number[] = []
    for (let i = 1; i < samples.length; i++) {
      if (samples[i]!.area !== samples[i - 1]!.area) jumpsAtSwitches.push(Math.abs(samples[i]!.y - samples[i - 1]!.y))
    }
    expect(jumpsAtSwitches.length).toBeGreaterThan(0)
    expect(Math.max(...jumpsAtSwitches)).toBeLessThanOrEqual(25)
  })

  await test.step('movement is interpolated, not teleported', async () => {
    const transition = await cursorOf(pageB, owner).evaluate((el) => getComputedStyle(el).transition)
    expect(transition).toContain('transform 0.1s')
  })

  await test.step('outgoing cursor updates are throttled', async () => {
    const start = await centerOf(pageA, 'To Do')
    const end = await centerOf(pageA, 'Done')
    await pageA.mouse.move(start.x, start.y)
    await pageA.waitForTimeout(100)
    cursorFramesSent = 0
    const t0 = Date.now()
    await pageA.mouse.move(end.x, end.y, { steps: 80 }) // 80 mousemove events
    const elapsed = Date.now() - t0
    await pageA.waitForTimeout(100) // let the final trailing position go out

    // At most one per 40ms (+ the leading and trailing sends), and far fewer than 80
    expect(cursorFramesSent).toBeLessThanOrEqual(Math.ceil((elapsed + 100) / 40) + 2)
    expect(cursorFramesSent).toBeLessThan(40)
    // The resting position still arrived
    await expectCursorOver(pageB, owner, await centerOf(pageB, 'Done'))
  })

  await test.step('the cursor layer never blocks drag-and-drop', async () => {
    const todo = column(pageA, 'To Do')
    await todo.getByPlaceholder('Add a card...').fill(cardTitle)
    await todo.getByRole('button', { name: 'Add' }).click()
    const card = todo.locator('.board-card', { hasText: cardTitle })
    await expect(card).toBeVisible()

    // Put B's cursor right on top of the card in A's view, then drag through it
    await pageB.locator('.board').evaluate((el) => (el.scrollLeft = 0))
    const cardOnB = (await column(pageB, 'To Do').getByText(cardTitle).boundingBox())!
    await pageB.mouse.move(cardOnB.x + 20, cardOnB.y + 8)
    const cardOnA = (await card.getByText(cardTitle).boundingBox())!
    await expectCursorOver(pageA, member, { x: cardOnA.x + 20, y: cardOnA.y + 8 })

    await card.dragTo(column(pageA, 'In Progress'))
    await expect(column(pageA, 'In Progress').getByText(cardTitle)).toBeVisible()
    await expect(column(pageB, 'In Progress').getByText(cardTitle)).toBeVisible()
  })

  await test.step("closing a tab removes that user's cursor for everyone else", async () => {
    await expect(cursorOf(pageA, member)).toBeVisible()
    await pageB.context().close()
    await expect(cursorOf(pageA, member)).toHaveCount(0, { timeout: 8_000 })
  })

  await pageA.context().close()
})
