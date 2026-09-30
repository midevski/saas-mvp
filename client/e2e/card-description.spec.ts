import { expect, test, type Page } from '@playwright/test'
import { createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Long descriptions are clamped to two lines on the card face, with "View more" to read them.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const LONG =
  "Fandom's League of Legends Esports wiki covers tournaments, teams, players, and personalities in League of " +
  'Legends. Pages that were modified between April 2014 and June 2016 are adapted from information taken from ' +
  'Esportspedia.com. Pages modified between June 2016 and September 2017 are adapted from information taken from ' +
  'EsportsWikis.com. Content is available under CC BY-SA 3.0 unless otherwise noted.'
const SHORT = 'Quick note.'

let owner: TestUser
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, `Desc Org ${runId}`)
  activateSubscription(orgId)
})

const cardFace = (page: Page, title: string) => page.locator('.board-card', { hasText: title })

async function addCardWithDescription(page: Page, title: string, description: string) {
  const todo = page.locator('.board-column', { has: page.getByRole('heading', { name: 'To Do', exact: true }) })
  await todo.getByPlaceholder('Add a card...').fill(title)
  await todo.getByRole('button', { name: 'Add' }).click()
  await cardFace(page, title).getByRole('button', { name: title }).click()
  const detail = page.getByRole('dialog', { name: title })
  await detail.getByLabel('Description').fill(description)
  await detail.getByRole('button', { name: 'Save changes' }).click()
  await expect(detail.getByText('Saved')).toBeVisible()
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toHaveCount(0)
}

test('long descriptions stop at two lines with "View more"; short ones are shown in full', async ({ page }) => {
  await logIn(page, owner)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await addCardWithDescription(page, 'Esports wiki', LONG)
  await addCardWithDescription(page, 'Small card', SHORT)

  await test.step('the long one is clamped to two lines, with "View more"', async () => {
    const desc = cardFace(page, 'Esports wiki').locator('.board-card-desc')
    const box = await desc.evaluate((el) => ({
      height: el.clientHeight,
      full: el.scrollHeight,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }))
    expect(box.height).toBeLessThanOrEqual(box.lineHeight * 2 + 1) // two lines
    expect(box.full).toBeGreaterThan(box.height) // the rest is hidden
    await expect(cardFace(page, 'Esports wiki').getByRole('button', { name: 'View more' })).toBeVisible()
  })

  await test.step('the short one needs no "View more"', async () => {
    await expect(cardFace(page, 'Small card').getByText(SHORT)).toBeVisible()
    await expect(cardFace(page, 'Small card').getByRole('button', { name: 'View more' })).toHaveCount(0)
  })

  await test.step('"View more" opens the card with the whole description readable', async () => {
    await cardFace(page, 'Esports wiki').getByRole('button', { name: 'View more' }).click()
    const detail = page.getByRole('dialog', { name: 'Esports wiki' })
    const description = detail.getByLabel('Description')
    await expect(description).toHaveValue(LONG)
    // The box grew to fit the text instead of scrolling inside a tiny box
    const fits = await description.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
    expect(fits).toBe(true)

    // Editing it down to something short removes "View more" from the card face
    await description.fill(SHORT)
    await detail.getByRole('button', { name: 'Save changes' }).click()
    await detail.getByRole('button', { name: 'Close' }).click()
    await expect(cardFace(page, 'Esports wiki').getByRole('button', { name: 'View more' })).toHaveCount(0)
  })
})

test('long titles — even one unbroken word — are clamped too, and never overflow', async ({ page }) => {
  const sentence = 'A really long card title that keeps going '.repeat(6).slice(0, 200).trim() // the 200-char max
  const unbroken = 'x'.repeat(200) // e.g. a pasted URL: nothing to wrap at
  await logIn(page, owner)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  // One with a long description too: still exactly one "View more"
  await addCardWithDescription(page, sentence, LONG)
  const todo = page.locator('.board-column', { has: page.getByRole('heading', { name: 'To Do', exact: true }) })
  await todo.getByPlaceholder('Add a card...').fill(unbroken)
  await todo.getByRole('button', { name: 'Add' }).click()

  for (const title of [sentence, unbroken]) {
    await test.step(`card face: ${title.slice(0, 20)}…`, async () => {
      const face = cardFace(page, title)
      const text = face.locator('.board-card-title-text')
      const box = await text.evaluate((el) => ({
        height: el.clientHeight,
        full: el.scrollHeight,
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }))
      expect(box.height).toBeLessThanOrEqual(box.lineHeight * 2 + 1) // two lines
      expect(box.full).toBeGreaterThan(box.height) // the rest is hidden
      // The card never gets wider than its column
      expect(await face.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      // Full title on hover, and exactly one "View more"
      await expect(face.getByRole('button', { name: title })).toHaveAttribute('title', title)
      await expect(face.getByRole('button', { name: 'View more' })).toHaveCount(1)
    })
  }

  await test.step('"View more" opens the card; its header wraps instead of overflowing', async () => {
    await cardFace(page, unbroken).getByRole('button', { name: 'View more' }).click()
    const detail = page.getByRole('dialog', { name: unbroken })
    await expect(detail.getByLabel('Title')).toHaveValue(unbroken)
    const heading = detail.getByRole('heading', { name: unbroken })
    expect(await heading.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
})
