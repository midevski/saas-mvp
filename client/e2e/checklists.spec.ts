import { expect, test, type Locator, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Checklists with two users who both have the *same card* open: every change shows up live in
// the other's detail view, checking is instant (optimistic), and who-checked-what is recorded.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Checklist Org ${runId}`
const cardTitle = `Launch ${runId}`

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

async function openBoard(page: Page, user: TestUser) {
  await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

function cardFace(page: Page) {
  return page.locator('.board-card', { hasText: cardTitle })
}

async function openCard(page: Page) {
  await cardFace(page).getByRole('button', { name: cardTitle }).click()
  const detail = page.getByRole('dialog', { name: cardTitle })
  await expect(detail).toBeVisible()
  return detail
}

function checklistIn(detail: Locator, title: string) {
  return detail.getByRole('group', { name: title })
}

async function storedItems(page: Page, user: TestUser) {
  const res = await page.request.get(`/api/orgs/${orgId}/board`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
  })
  const card = (await res.json()).cards.find((c: { title: string }) => c.title === cardTitle)
  return card.checklists.flatMap((c: { items: unknown[] }) => c.items) as {
    text: string
    completed: boolean
    completedBy: string | null
    completedAt: string | null
  }[]
}

test('checklists: live for two users with the same card open, optimistic, who-checked recorded', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)

  const todo = a.locator('.board-column', { has: a.getByRole('heading', { name: 'To Do', exact: true }) })
  await todo.getByPlaceholder('Add a card...').fill(cardTitle)
  await todo.getByRole('button', { name: 'Add' }).click()
  await expect(cardFace(b)).toBeVisible()

  const detailA = await openCard(a)
  const detailB = await openCard(b)

  await test.step('A adds a checklist and items; B sees them appear in the open card', async () => {
    await detailA.getByRole('button', { name: '+ Add checklist' }).click()
    await detailA.getByLabel('Checklist title').fill('Launch steps')
    await detailA.getByRole('button', { name: 'Add checklist' }).click()
    const listA = checklistIn(detailA, 'Launch steps')
    await expect(listA).toBeVisible()

    const addInput = listA.getByLabel('Add an item to Launch steps')
    for (const text of ['Write copy', 'Design hero', 'Ship it']) {
      await addInput.fill(text)
      await addInput.press('Enter') // stays focused for the next one
      await expect(listA.getByRole('checkbox', { name: text })).toBeEnabled() // server-confirmed
    }

    const listB = checklistIn(detailB, 'Launch steps')
    await expect(listB.getByRole('checkbox')).toHaveCount(3)
    await expect(listB.getByLabel('0 of 3 done')).toBeVisible()
  })

  const listA = checklistIn(detailA, 'Launch steps')
  const listB = checklistIn(detailB, 'Launch steps')

  await test.step("B checks an item; A's open card and both board faces update live", async () => {
    await listB.getByRole('checkbox', { name: 'Write copy' }).check()
    await expect(listA.getByRole('checkbox', { name: 'Write copy' })).toBeChecked()
    await expect(listA.locator('.checklist-item.is-done')).toContainText('Write copy') // strikethrough
    await expect(listA.getByLabel('1 of 3 done')).toBeVisible()
    await expect(cardFace(a).getByLabel('Checklist: 1 of 3 done')).toBeAttached()
    await expect(cardFace(b).getByLabel('Checklist: 1 of 3 done')).toBeAttached()
  })

  await test.step('checking is instant — the UI updates before the server responds', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    await a.route('**/items/*', async (route) => {
      await held
      await route.continue()
    })

    await listA.getByRole('checkbox', { name: 'Design hero' }).check()
    // Request still held back, yet the box and progress already reflect it
    await expect(listA.getByRole('checkbox', { name: 'Design hero' })).toBeChecked()
    await expect(listA.getByLabel('2 of 3 done')).toBeVisible()

    release()
    await expect(listB.getByLabel('2 of 3 done')).toBeVisible() // server confirmed & broadcast
    await expect(listA.getByLabel('2 of 3 done')).toBeVisible()
    await a.unroute('**/items/*')
  })

  await test.step('the server recorded who checked each item, and when', async () => {
    const items = await storedItems(a, owner)
    const byText = Object.fromEntries(items.map((i) => [i.text, i]))
    expect(byText['Write copy']).toMatchObject({ completed: true, completedBy: member.id })
    expect(byText['Design hero']).toMatchObject({ completed: true, completedBy: owner.id })
    expect(byText['Ship it']).toMatchObject({ completed: false, completedBy: null, completedAt: null })
    expect(Date.parse(byText['Write copy']!.completedAt!)).toBeGreaterThan(Date.now() - 5 * 60_000)
  })

  await test.step('renaming an item (Enter saves, Escape cancels just the edit)', async () => {
    await listA.getByRole('button', { name: 'Ship it', exact: true }).click()
    await listA.getByLabel('Edit "Ship it"').fill('discarded')
    await listA.getByLabel('Edit "Ship it"').press('Escape')
    await expect(detailA).toBeVisible() // Escape didn't close the card
    await expect(listA.getByRole('checkbox', { name: 'Ship it' })).toBeVisible()

    await listA.getByRole('button', { name: 'Ship it', exact: true }).click()
    await listA.getByLabel('Edit "Ship it"').fill('Ship it today')
    await listA.getByLabel('Edit "Ship it"').press('Enter')
    await expect(listB.getByRole('checkbox', { name: 'Ship it today' })).toBeVisible()
  })

  await test.step('unchecking clears who/when', async () => {
    await listB.getByRole('checkbox', { name: 'Write copy' }).uncheck()
    await expect(listA.getByRole('checkbox', { name: 'Write copy' })).not.toBeChecked()
    await expect(listA.getByLabel('1 of 3 done')).toBeVisible()
    const writeCopy = (await storedItems(a, owner)).find((i) => i.text === 'Write copy')!
    expect(writeCopy).toMatchObject({ completed: false, completedBy: null, completedAt: null })
  })

  await test.step('deleting an item', async () => {
    await listA.getByRole('checkbox', { name: 'Ship it today' }).hover()
    await listA.getByRole('button', { name: 'Delete item "Ship it today"' }).click()
    await expect(listB.getByRole('checkbox', { name: 'Ship it today' })).toHaveCount(0)
    await expect(listB.getByLabel('1 of 2 done')).toBeVisible()
  })

  await test.step('deleting the whole checklist asks for confirmation', async () => {
    await listA.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirm = a.getByRole('dialog', { name: 'Delete this checklist?' })
    await expect(confirm).toContainText('Launch steps and its 2 items will be removed')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(detailA).toBeVisible()
    await expect(listA).toBeVisible()

    await listA.getByRole('button', { name: 'Delete', exact: true }).click()
    await a.getByRole('dialog', { name: 'Delete this checklist?' }).getByRole('button', { name: 'Delete checklist' }).click()
    await expect(listA).toHaveCount(0)
    await expect(listB).toHaveCount(0)
    await expect(cardFace(b).getByLabel(/Checklist:/)).toHaveCount(0)
    expect(await storedItems(a, owner)).toEqual([])
  })

  await a.context().close()
  await b.context().close()
})
