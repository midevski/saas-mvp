import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Mention notifications: the navbar bell updates live on any page, deep-links to the card (and
// comment), and read state persists.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Notify Org ${runId}`
const cardTitle = `Launch ${runId}`

let owner: TestUser
let member: TestUser
let bystander: TestUser
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  member = await registerUser(request, 'Max Member', `member-${runId}@e2e.test`)
  bystander = await registerUser(request, 'Lou Lurker', `lou-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, orgName)
  await addMember(request, orgId, owner, member, 'member')
  await addMember(request, orgId, owner, bystander, 'member')
  activateSubscription(orgId)
})

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ })
const badge = (page: Page) => bell(page).locator('.notif-badge')
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notifications' })

async function getBoard(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${owner.accessToken}` }
  const board = await (await request.get(`/api/orgs/${orgId}/board`, { headers })).json()
  return board as { board: { id: string }; columns: { id: string }[]; cards: { id: string; title: string }[] }
}

// Fast setup for volume: the same endpoint the composer uses
async function mentionViaApi(request: APIRequestContext, cardId: string, text: string) {
  const res = await request.post(`/api/orgs/${orgId}/board/cards/${cardId}/comments`, {
    headers: { Authorization: `Bearer ${owner.accessToken}` },
    data: { text, mentionedUserIds: [member.id] },
  })
  expect(res.ok()).toBe(true)
}

test('mentions notify live on any page, deep-link to the comment, and stay read after re-login', async ({
  browser,
  request,
}) => {
  const ownerPage = await (await browser.newContext()).newPage()
  const memberPage = await (await browser.newContext()).newPage()
  const bystanderPage = await (await browser.newContext()).newPage()

  await logIn(ownerPage, owner)
  await logIn(memberPage, member) // stays on the dashboard — not the board
  await logIn(bystanderPage, bystander)
  await expect(bell(memberPage)).toHaveAccessibleName('Notifications')
  await expect(badge(memberPage)).toHaveCount(0)

  await test.step('the owner mentions Max using the picker', async () => {
    await ownerPage.goto(`/orgs/${orgId}/board`)
    await expect(ownerPage.getByText('Live', { exact: true })).toBeVisible()
    const todo = ownerPage.locator('.board-column', { has: ownerPage.getByRole('heading', { name: 'To Do', exact: true }) })
    await todo.getByPlaceholder('Add a card...').fill(cardTitle)
    await todo.getByRole('button', { name: 'Add' }).click()
    await ownerPage.locator('.board-card', { hasText: cardTitle }).getByRole('button', { name: cardTitle }).click()
    const box = ownerPage.getByRole('dialog', { name: cardTitle }).getByLabel('Write a comment')
    await box.pressSequentially('Can you review this, @Ma')
    await ownerPage.getByRole('option', { name: 'Max Member' }).click()
    await box.pressSequentially('?')
    await box.press('Enter')
    await expect(box).toHaveValue('')
  })

  await test.step("Max's bell lights up live on the dashboard; the bystander's doesn't", async () => {
    await expect(badge(memberPage)).toHaveText('1')
    await expect(bell(memberPage)).toHaveAccessibleName('Notifications, 1 unread')
    await expect(memberPage).toHaveURL(/\/$/) // still on the dashboard, no reload
    await expect(badge(bystanderPage)).toHaveCount(0)
    await expect(badge(ownerPage)).toHaveCount(0) // the author isn't notified
  })

  await test.step('clicking the notification opens that card with the comment highlighted, and marks it read', async () => {
    await bell(memberPage).click()
    const item = panel(memberPage).getByRole('button', { name: /Olga Owner mentioned you/ })
    await expect(item).toContainText(`Olga Owner mentioned you on "${cardTitle}": "Can you review this, @Max Member ?"`)
    await expect(item).toHaveAccessibleName(/^Unread:/)
    await item.click()

    await expect(memberPage).toHaveURL(new RegExp(`/orgs/${orgId}/board$`)) // link consumed
    const detail = memberPage.getByRole('dialog', { name: cardTitle })
    await expect(detail).toBeVisible()
    await expect(detail.locator('.activity-comment.is-highlighted')).toContainText('Can you review this')
    await expect(badge(memberPage)).toHaveCount(0)
  })

  const { cards } = await getBoard(request)
  const cardId = cards.find((c) => c.title === cardTitle)!.id

  await test.step('the badge caps at 9+', async () => {
    for (let i = 1; i <= 10; i++) await mentionViaApi(request, cardId, `Ping ${i}`)
    await expect(badge(memberPage)).toHaveText('9+')
    await expect(bell(memberPage)).toHaveAccessibleName('Notifications, 10 unread')
  })

  await test.step('"Mark all as read" clears the count and every item', async () => {
    await memberPage.goto('/')
    await bell(memberPage).click()
    await expect(panel(memberPage).locator('.notif-item.is-unread')).toHaveCount(10)
    await panel(memberPage).getByRole('button', { name: 'Mark all as read' }).click()
    await expect(badge(memberPage)).toHaveCount(0)
    await expect(panel(memberPage).locator('.notif-item.is-unread')).toHaveCount(0)
    await expect(panel(memberPage).getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  await test.step('notifications and their read state persist across logging out and in', async () => {
    await memberPage.getByRole('button', { name: 'Account menu' }).click()
    await memberPage.getByRole('menuitem', { name: 'Log out' }).click()
    await logIn(memberPage, member)
    await expect(bell(memberPage)).toHaveAccessibleName('Notifications')
    await bell(memberPage).click()
    await expect(panel(memberPage).locator('.notif-item')).toHaveCount(11)
    await expect(panel(memberPage).locator('.notif-item.is-unread')).toHaveCount(0)
  })

  await test.step('a notification for a card that was deleted since says so instead of failing', async () => {
    const doomed = `Doomed ${runId}`
    await ownerPage.keyboard.press('Escape')
    const todo = ownerPage.locator('.board-column', { has: ownerPage.getByRole('heading', { name: 'To Do', exact: true }) })
    await todo.getByPlaceholder('Add a card...').fill(doomed)
    await todo.getByRole('button', { name: 'Add' }).click()
    await expect(ownerPage.locator('.board-card', { hasText: doomed })).toBeVisible()
    const board = await getBoard(request)
    const doomedId = board.cards.find((c) => c.title === doomed)!.id
    await mentionViaApi(request, doomedId, 'About to vanish')
    await expect(badge(memberPage)).toHaveText('1')

    const card = ownerPage.locator('.board-card', { hasText: doomed })
    await card.hover()
    await card.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(ownerPage.locator('.board-card', { hasText: doomed })).toHaveCount(0)

    await panel(memberPage).getByRole('button', { name: /About to vanish/ }).click()
    await expect(memberPage.getByRole('status')).toContainText('That card no longer exists')
    await expect(memberPage.getByRole('dialog', { name: doomed })).toHaveCount(0)
  })
})
