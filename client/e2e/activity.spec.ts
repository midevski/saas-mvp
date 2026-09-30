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

  await test.step('typing @ and a letter opens a live-filtering member picker; picking inserts the name', async () => {
    const box = detailA.getByLabel('Write a comment')
    const picker = a.getByRole('listbox', { name: 'Mention someone' })
    await box.pressSequentially('Hi @')
    await expect(picker).toHaveCount(0) // '@' alone doesn't open it
    await box.pressSequentially('m')
    await expect(picker.getByRole('option')).toHaveCount(1)
    await expect(picker.getByRole('option', { name: 'Max Member' })).toBeVisible()
    await box.pressSequentially('ax m')
    await expect(picker.getByRole('option', { name: 'Max Member' })).toBeVisible() // still filtering live
    await box.press('Enter') // picks the highlighted suggestion rather than posting
    await expect(box).toHaveValue('Hi @Max Member ')
    await expect(picker).toHaveCount(0)

    // No match: the dropdown stays closed and the text stays plain
    await box.pressSequentially(', can you ask @Nobody Here?')
    await expect(picker).toHaveCount(0)
  })

  await test.step('Enter posts it: instant for the poster, live for the other user, with only the pick highlighted', async () => {
    const box = detailA.getByLabel('Write a comment')
    await box.press('Enter')
    await expect(box).toHaveValue('')

    for (const detail of [detailA, detailB]) {
      const comment = feed(detail).locator('.activity-comment').first()
      await expect(comment).toContainText('Olga Owner')
      await expect(comment).toContainText('Hi @Max Member , can you ask @Nobody Here?')
      await expect(comment.locator('.mention')).toHaveText(['@Max Member'])
    }
    await expect(detailB.getByText('1 comment', { exact: true })).toBeVisible()
  })

  await test.step('a name typed by hand (never picked) is plain text, not a mention', async () => {
    const box = detailB.getByLabel('Write a comment')
    await box.pressSequentially('Thanks @Ol')
    await expect(b.getByRole('listbox', { name: 'Mention someone' })).toBeVisible()
    // Escape closes only the picker — the card stays open
    await box.press('Escape')
    await expect(b.getByRole('listbox', { name: 'Mention someone' })).toHaveCount(0)
    await expect(detailB).toBeVisible()
    await box.pressSequentially('ga Owner')
    await box.press('Enter')
    const comment = feed(detailA).locator('.activity-comment').first()
    await expect(comment).toContainText('Thanks @Olga Owner')
    await expect(comment.locator('.mention')).toHaveCount(0)
  })

  await test.step('Shift+Enter adds a line instead of posting', async () => {
    const box = detailB.getByLabel('Write a comment')
    await box.fill('line one')
    await box.press('Shift+Enter')
    await box.pressSequentially('line two')
    await expect(box).toHaveValue('line one\nline two')
    await detailB.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(feed(detailA).locator('.activity-comment').first()).toContainText('line one\nline two')
    await expect(detailA.getByText('3 comments', { exact: true })).toBeVisible()
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
      /Max Member.*Thanks @Olga Owner/,
      /Olga Owner.*Hi @Max Member/,
      /Olga Owner created this card/,
    ])
  })

  await test.step("a member can delete their own comments but not someone else's; system entries never", async () => {
    await expect(detailB.getByRole('button', { name: 'Delete comment by Max Member' })).toHaveCount(2)
    await expect(detailB.getByRole('button', { name: 'Delete comment by Olga Owner' })).toHaveCount(0)
    await expect(feed(detailB).locator('.activity-system button')).toHaveCount(0)
  })

  await test.step("the owner deletes a member's comment after confirming; it vanishes live for both", async () => {
    const target = feed(detailA).locator('.activity-comment', { hasText: 'line one' })
    await target.hover()
    await target.getByRole('button', { name: 'Delete comment by Max Member' }).click()
    const confirm = a.getByRole('dialog', { name: 'Delete this comment?' })
    await expect(confirm).toContainText("Max Member's comment will be removed")

    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(target).toBeVisible()

    await target.getByRole('button', { name: 'Delete comment by Max Member' }).click()
    await confirm.getByRole('button', { name: 'Delete comment' }).click()
    await expect(target).toHaveCount(0)
    await expect(feed(detailB).locator('.activity-comment', { hasText: 'line one' })).toHaveCount(0)
    await expect(detailB.getByText('2 comments', { exact: true })).toBeVisible()
  })

  await test.step('a member deletes their own comment', async () => {
    const own = feed(detailB).locator('.activity-comment', { hasText: 'Thanks @Olga Owner' })
    await own.hover()
    await own.getByRole('button', { name: 'Delete comment by Max Member' }).click()
    await b.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete comment' }).click()
    await expect(own).toHaveCount(0)
    await expect(feed(detailA).locator('.activity-comment', { hasText: 'Thanks @Olga Owner' })).toHaveCount(0)
    await expect(detailA.getByText('1 comment', { exact: true })).toBeVisible()
  })
})
