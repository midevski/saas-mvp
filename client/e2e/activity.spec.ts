import { expect, test, type Locator, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// A card's activity feed with two users who both have the same card open: comments and system
// entries (checklist ticks, moves) show up live in the other's feed, newest first, with
// @mentions of real members highlighted.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Activity Org ${runId}`
const cardTitle = `Feed ${runId}`

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

const column = (page: Page, name: string) =>
  page.locator('.board-column', { has: page.getByRole('heading', { name, exact: true }) })
const cardFace = (page: Page) => page.locator('.board-card', { hasText: cardTitle })

async function openCard(page: Page) {
  await cardFace(page).getByRole('button', { name: cardTitle }).click()
  const detail = page.getByRole('dialog', { name: cardTitle })
  await expect(detail).toBeVisible()
  return detail
}

const feed = (detail: Locator) => detail.getByRole('list', { name: 'Card activity' })
const entries = (detail: Locator) => feed(detail).getByRole('listitem')

test('activity feed: comments and system entries, live for two users, newest first', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)

  await column(a, 'To Do').getByPlaceholder('Add a card...').fill(cardTitle)
  await column(a, 'To Do').getByRole('button', { name: 'Add' }).click()
  await expect(cardFace(b)).toBeVisible()

  let detailA = await openCard(a)
  const detailB = await openCard(b)

  await test.step('a new card starts with "created this card"', async () => {
    await expect(entries(detailB)).toHaveCount(1)
    await expect(entries(detailB).first()).toHaveText(/Olga Owner created this card · just now/)
  })

  await test.step('Enter posts a comment: instant for the poster, live for the other user', async () => {
    const box = detailA.getByLabel('Write a comment')
    await box.fill('Hi @Max Member, can you ask @Nobody Here?')
    await box.press('Enter')
    await expect(box).toHaveValue('')

    for (const detail of [detailA, detailB]) {
      const comment = feed(detail).locator('.activity-comment').first()
      await expect(comment).toContainText('Olga Owner')
      await expect(comment).toContainText('Hi @Max Member, can you ask @Nobody Here?')
      // Only the real member is highlighted as a mention
      await expect(comment.locator('.mention')).toHaveText(['@Max Member'])
    }
    await expect(detailB.getByText('1 comment', { exact: true })).toBeVisible()
  })

  await test.step('Shift+Enter adds a line instead of posting', async () => {
    const box = detailB.getByLabel('Write a comment')
    await box.fill('line one')
    await box.press('Shift+Enter')
    await box.pressSequentially('line two')
    await expect(box).toHaveValue('line one\nline two')
    await detailB.getByRole('button', { name: 'Comment' }).click()
    await expect(feed(detailA).locator('.activity-comment').first()).toContainText('line one\nline two')
    await expect(detailA.getByText('2 comments', { exact: true })).toBeVisible()
  })

  await test.step("checking a checklist item logs it in the other user's open feed", async () => {
    await detailB.getByRole('button', { name: '+ Add checklist' }).click()
    await detailB.getByLabel('Checklist title').fill('Steps')
    await detailB.getByRole('button', { name: 'Add checklist' }).click()
    const list = detailB.getByRole('group', { name: 'Steps' })
    await list.getByLabel('Add an item to Steps').fill('Ship it')
    await list.getByLabel('Add an item to Steps').press('Enter')
    await expect(list.getByRole('checkbox', { name: 'Ship it' })).toBeEnabled()
    await list.getByRole('checkbox', { name: 'Ship it' }).check()

    const newest = entries(detailA).first()
    await expect(newest).toHaveText(/Max Member checked off 'Ship it'/)
    // System lines are log lines, not comments: no avatar bubble
    await expect(newest).toHaveClass(/activity-system/)
    await expect(newest.locator('.avatar-circle')).toHaveCount(0)
  })

  await test.step("moving the card logs it in the other user's open feed", async () => {
    await detailA.getByRole('button', { name: 'Close' }).click()
    await expect(detailA).toHaveCount(0)
    await cardFace(a).dragTo(column(a, 'Done'))
    await expect(entries(detailB).first()).toHaveText(/Olga Owner moved this card from To Do to Done/)
  })

  await test.step('the whole timeline persists, newest first, one entry each', async () => {
    detailA = await openCard(a)
    await expect(entries(detailA)).toHaveText([
      /Olga Owner moved this card from To Do to Done/,
      /Max Member checked off 'Ship it'/,
      /Max Member.*line one\nline two/s,
      /Olga Owner.*Hi @Max Member/,
      /Olga Owner created this card/,
    ])
  })

  await test.step('there is no way to edit or delete a comment', async () => {
    const comment = feed(detailA).locator('.activity-comment').first()
    await comment.hover()
    await expect(comment.getByRole('button')).toHaveCount(0)
  })
})
