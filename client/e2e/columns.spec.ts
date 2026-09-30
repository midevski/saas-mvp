import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Custom columns: add / rename / reorder / delete (two ways) live for everyone, and collapse,
// which is strictly local to one browser.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

let owner: TestUser
let member: TestUser
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  member = await registerUser(request, 'Max Member', `member-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, `Columns Org ${runId}`)
  await addMember(request, orgId, owner, member, 'member')
  activateSubscription(orgId)
})

async function openBoard(page: Page, user?: TestUser) {
  if (user) await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

function column(page: Page, name: string) {
  return page.locator('.board-column', { has: page.getByRole('heading', { name, exact: true }) })
}

async function columnOrder(page: Page) {
  return page.locator('.board-track > .board-column').evaluateAll((els) =>
    els.map((el) => el.querySelector('h3')?.textContent?.trim() ?? ''),
  )
}

async function addColumn(page: Page, name: string) {
  await page.getByRole('button', { name: '+ Add column' }).click()
  await page.getByLabel('Column name').fill(name)
  await page.getByRole('button', { name: 'Add column', exact: true }).click()
  await expect(column(page, name)).toBeVisible()
}

async function addCard(page: Page, columnName: string, title: string) {
  const col = column(page, columnName)
  await col.getByPlaceholder('Add a card...').fill(title)
  await col.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(col.getByText(title, { exact: true })).toBeVisible()
}

async function openDelete(page: Page, columnName: string) {
  await page.getByRole('button', { name: `${columnName} column options` }).click()
  await page.getByRole('menuitem', { name: 'Delete column' }).click()
  const dialog = page.getByRole('dialog', { name: `Delete "${columnName}"?` })
  await expect(dialog).toBeVisible()
  return dialog
}

test('columns: add, rename and delete are live for everyone; reordering is just for me', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)

  await test.step('adding a column puts it at the end, for everyone', async () => {
    await addColumn(a, 'Review')
    await expect(column(b, 'Review')).toBeVisible()
    expect(await columnOrder(b)).toEqual(['To Do', 'In Progress', 'Done', 'Review'])
  })

  await test.step('renaming (click the title) updates live', async () => {
    await column(a, 'Review').getByRole('button', { name: 'Review', exact: true }).click()
    await a.getByLabel('Column name').fill('QA')
    await a.getByLabel('Column name').press('Enter')
    await expect(column(b, 'QA')).toBeVisible()
    await expect(column(b, 'Review')).toHaveCount(0)
  })

  await test.step("dragging a column reorders it for me only — nobody else's board moves", async () => {
    const traffic: string[] = []
    a.on('request', (req) => traffic.push(req.url()))
    a.on('websocket', (ws) => ws.on('framesent', (f) => traffic.push(String(f.payload))))

    // Drag "QA" by its grip onto the left half of "In Progress" -> lands before it
    const target = (await column(a, 'In Progress').boundingBox())!
    await column(a, 'QA').locator('.column-drag-handle').dragTo(column(a, 'In Progress'), {
      targetPosition: { x: 20, y: target.height / 2 },
    })
    expect(await columnOrder(a)).toEqual(['To Do', 'QA', 'In Progress', 'Done'])

    await b.waitForTimeout(800)
    expect(await columnOrder(b)).toEqual(['To Do', 'In Progress', 'Done', 'QA']) // unchanged
    // Nothing about the move left this browser (live-cursor frames aside)
    const sent = traffic.filter((t) => !t.includes('cursor:move'))
    expect(sent.filter((t) => /column|order/i.test(t))).toEqual([])
    expect(sent.filter((t) => t.includes('/api/'))).toEqual([])
  })

  await test.step('my order survives a refresh, but not in another browser', async () => {
    await a.reload()
    await expect(a.getByText('Live', { exact: true })).toBeVisible()
    expect(await columnOrder(a)).toEqual(['To Do', 'QA', 'In Progress', 'Done'])

    const otherBrowser = await (await browser.newContext()).newPage()
    await openBoard(otherBrowser, owner)
    expect(await columnOrder(otherBrowser)).toEqual(['To Do', 'In Progress', 'Done', 'QA'])
    await otherBrowser.context().close()
  })

  await test.step('the menu can also move a column (keyboard-friendly), also just for me', async () => {
    await a.getByRole('button', { name: 'QA column options' }).click()
    await a.getByRole('menuitem', { name: 'Move right' }).click()
    expect(await columnOrder(a)).toEqual(['To Do', 'In Progress', 'QA', 'Done'])
    await b.waitForTimeout(500)
    expect(await columnOrder(b)).toEqual(['To Do', 'In Progress', 'Done', 'QA'])
  })

  await test.step('with different column orders, a cursor still lands on the same column', async () => {
    // A: To Do, In Progress, QA, Done — B: To Do, In Progress, Done, QA
    const headingOn = async (page: Page, name: string) =>
      (await column(page, name).getByRole('heading', { name, exact: true }).boundingBox())!
    const onA = await headingOn(a, 'QA')
    await a.mouse.move(onA.x + 10, onA.y + 8)
    const cursor = b.locator(`[data-cursor-user="${owner.name}"]`)
    await expect(cursor).toHaveAttribute('data-cursor-area', 'columnFrame')
    await expect
      .poll(async () => {
        const onB = await headingOn(b, 'QA') // a different spot on B's screen
        const at = (await cursor.boundingBox())!
        return Math.max(Math.abs(at.x - (onB.x + 10)), Math.abs(at.y - (onB.y + 8)))
      })
      .toBeLessThanOrEqual(3)
  })

  await test.step('deleting an empty column is a plain confirmation', async () => {
    await addColumn(a, 'Temp')
    const dialog = await openDelete(a, 'Temp')
    await expect(dialog).toContainText('This column is empty')
    await expect(dialog.getByRole('radio')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Delete column' }).click()
    await expect(column(a, 'Temp')).toHaveCount(0)
    await expect(column(b, 'Temp')).toHaveCount(0)
  })

  await test.step('deleting a column with cards can move them to another column', async () => {
    await addCard(a, 'QA', 'Check login')
    await addCard(a, 'QA', 'Check billing')
    await addCard(a, 'Done', 'Old task')

    const dialog = await openDelete(a, 'QA')
    await expect(dialog).toContainText('This column has 2 cards')
    await dialog.getByLabel('Destination column').selectOption({ label: 'Done' })
    await dialog.getByRole('button', { name: 'Move cards & delete column' }).click()

    for (const page of [a, b]) {
      await expect(column(page, 'QA')).toHaveCount(0)
      // Appended to the bottom of Done, in their original order
      await expect(column(page, 'Done').locator('.board-card-title-text')).toHaveText([
        'Old task',
        'Check login',
        'Check billing',
      ])
    }
  })

  await test.step('...or delete them too', async () => {
    await addColumn(a, 'Scratch')
    await addCard(a, 'Scratch', 'Throwaway 1')
    await addCard(a, 'Scratch', 'Throwaway 2')
    const dialog = await openDelete(a, 'Scratch')
    await dialog.getByRole('radio', { name: /Delete cards too/ }).check()
    await dialog.getByRole('button', { name: 'Delete column & 2 cards' }).click()

    await expect(column(b, 'Scratch')).toHaveCount(0)
    await expect(b.getByText('Throwaway 1')).toHaveCount(0)
    // Really gone on the server, not just hidden
    const res = await a.request.get(`/api/orgs/${orgId}/board`, {
      headers: { Authorization: `Bearer ${owner.accessToken}` },
    })
    const titles = (await res.json()).cards.map((c: { title: string }) => c.title)
    expect(titles).not.toContain('Throwaway 1')
    expect(titles).toContain('Check login')
  })

  await a.context().close()
  await b.context().close()
})

test('collapsing a column is local to this browser: no traffic, survives refresh, nobody else sees it', async ({
  browser,
}) => {
  const aContext = await browser.newContext()
  const a = await aContext.newPage()
  const b = await (await browser.newContext()).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)
  await addCard(a, 'In Progress', 'Moving card')

  // Record every socket frame and HTTP request A sends while (un)collapsing
  const traffic: string[] = []
  a.on('request', (req) => traffic.push(`${req.method()} ${req.url()}`))
  a.on('websocket', (ws) => ws.on('framesent', (f) => traffic.push(`ws ${String(f.payload).slice(0, 80)}`)))

  await test.step('collapse shows only the title and count', async () => {
    await column(a, 'Done').getByRole('button', { name: 'Collapse Done' }).click()
    const strip = a.getByRole('region', { name: 'Done' })
    await expect(strip).toHaveClass(/is-collapsed/)
    await expect(strip.locator('.pill')).toHaveText(String(await column(b, 'Done').locator('.board-card').count()))
    await expect(strip.locator('.board-card')).toHaveCount(0)
  })

  await test.step('nothing about it was sent anywhere', async () => {
    await a.waitForTimeout(500)
    // (Moving the mouse to click still sends live-cursor frames — those are about the pointer
    // and legitimately mention a columnId, so they're excluded. Nothing else may mention it.)
    const nonCursor = traffic.filter((t) => !t.includes('cursor:move'))
    expect(nonCursor.filter((t) => /column|collapse/i.test(t))).toEqual([])
    expect(traffic.filter((t) => t.includes('/api/'))).toEqual([]) // no API calls at all
  })

  await test.step('the other user still sees it expanded', async () => {
    await expect(column(b, 'Done')).not.toHaveClass(/is-collapsed/)
    await expect(column(b, 'Done').getByPlaceholder('Add a card...')).toBeVisible()
  })

  await test.step("someone pointing at a column I've collapsed shows up on its strip", async () => {
    const heading = (await column(b, 'Done').getByRole('heading', { name: 'Done', exact: true }).boundingBox())!
    await b.mouse.move(heading.x + 150, heading.y + 8) // well to the right: wider than the strip
    const cursor = a.locator(`[data-cursor-user="${member.name}"]`)
    await expect(cursor).toHaveAttribute('data-cursor-area', 'columnFrame')
    const strip = (await a.getByRole('region', { name: 'Done' }).boundingBox())!
    await expect
      .poll(async () => {
        const at = (await cursor.boundingBox())!
        return at.x >= strip.x && at.x <= strip.x + strip.width && at.y >= strip.y && at.y <= strip.y + strip.height
      })
      .toBe(true)
  })

  await test.step('a card dropped on the collapsed strip is added to the bottom of that column', async () => {
    const before = await column(b, 'Done').locator('.board-card').count()
    await column(a, 'In Progress').locator('.board-card', { hasText: 'Moving card' }).dragTo(
      a.getByRole('region', { name: 'Done' }),
    )
    await expect(a.getByRole('region', { name: 'Done' }).locator('.pill')).toHaveText(String(before + 1))
    await expect(column(b, 'Done').locator('.board-card-title-text').last()).toHaveText('Moving card')
  })

  await test.step('it survives a refresh in this browser', async () => {
    await a.reload()
    await expect(a.getByText('Live', { exact: true })).toBeVisible()
    await expect(a.getByRole('region', { name: 'Done' })).toHaveClass(/is-collapsed/)
  })

  await test.step('...but not in another browser, even for the same user', async () => {
    const otherBrowser = await (await browser.newContext()).newPage()
    await openBoard(otherBrowser, owner)
    await expect(column(otherBrowser, 'Done')).not.toHaveClass(/is-collapsed/)
    await otherBrowser.context().close()
  })

  await test.step('clicking the strip expands it again', async () => {
    await a.getByRole('region', { name: 'Done' }).click()
    await expect(column(a, 'Done')).not.toHaveClass(/is-collapsed/)
    await expect(column(a, 'Done').getByPlaceholder('Add a card...')).toBeVisible()
  })

  await aContext.close()
  await b.context().close()
})
