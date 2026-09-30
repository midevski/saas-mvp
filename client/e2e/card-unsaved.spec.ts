import { expect, test, type Page } from '@playwright/test'
import { createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Closing a card with unsaved title/description edits asks first: save, discard, or keep editing.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const TITLE = `Plan launch ${runId}`

let owner: TestUser
let orgId = ''

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Olga Owner', `owner-${runId}@e2e.test`)
  orgId = await createOrg(request, owner, `Unsaved Org ${runId}`)
  activateSubscription(orgId)
})

const cardFace = (page: Page, title: string) => page.locator('.board-card', { hasText: title })
const prompt = (page: Page) => page.getByRole('dialog', { name: 'Save your changes?' })

async function openCard(page: Page, title: string) {
  await cardFace(page, title).getByRole('button', { name: title }).first().click()
  const detail = page.getByRole('dialog', { name: title })
  await expect(detail).toBeVisible()
  return detail
}

test('closing with unsaved edits asks to save, discard or keep editing', async ({ page }) => {
  await logIn(page, owner)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const todo = page.locator('.board-column', { has: page.getByRole('heading', { name: 'To Do', exact: true }) })
  await todo.getByPlaceholder('Add a card...').fill(TITLE)
  await todo.getByRole('button', { name: 'Add' }).click()

  await test.step('no changes: closes straight away, no prompt', async () => {
    const detail = await openCard(page, TITLE)
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await expect(detail).toHaveCount(0)
    await expect(prompt(page)).toHaveCount(0)
  })

  await test.step('× with an unsaved edit asks first; "Keep editing" keeps the edit', async () => {
    const detail = await openCard(page, TITLE)
    await detail.getByLabel('Title').fill(`${TITLE} v2`)
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await expect(prompt(page)).toContainText("You changed this card's title but haven't saved.")

    await prompt(page).getByRole('button', { name: 'Keep editing' }).click()
    await expect(prompt(page)).toHaveCount(0)
    await expect(detail).toBeVisible()
    await expect(detail.getByLabel('Title')).toHaveValue(`${TITLE} v2`)
  })

  await test.step('Escape asks too; Escape again closes only the prompt', async () => {
    const detail = page.getByRole('dialog', { name: TITLE })
    await detail.getByLabel('Description').fill('Some notes')
    await detail.getByLabel('Description').press('Escape')
    await expect(prompt(page)).toContainText("You changed this card's title and description")
    await page.keyboard.press('Escape')
    await expect(prompt(page)).toHaveCount(0)
    await expect(detail).toBeVisible()
  })

  await test.step('"Discard changes" closes without saving anything', async () => {
    const detail = page.getByRole('dialog', { name: TITLE })
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await prompt(page).getByRole('button', { name: 'Discard changes' }).click()
    await expect(detail).toHaveCount(0)
    await expect(cardFace(page, TITLE).getByRole('button', { name: TITLE, exact: true })).toBeVisible()
    await expect(cardFace(page, TITLE).locator('.board-card-desc')).toHaveCount(0)
  })

  await test.step('"Save changes" saves, then closes — and it sticks', async () => {
    const detail = await openCard(page, TITLE)
    await detail.getByLabel('Description').fill('Saved from the prompt')
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await prompt(page).getByRole('button', { name: 'Save changes' }).click()
    await expect(detail).toHaveCount(0)
    await expect(cardFace(page, TITLE).getByText('Saved from the prompt')).toBeVisible()
    await page.reload()
    await expect(cardFace(page, TITLE).getByText('Saved from the prompt')).toBeVisible()
  })

  await test.step('an empty title can only be discarded', async () => {
    const detail = await openCard(page, TITLE)
    await detail.getByLabel('Title').fill('   ')
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await expect(prompt(page)).toContainText('The title is empty')
    await expect(prompt(page).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    await prompt(page).getByRole('button', { name: 'Discard changes' }).click()
    await expect(detail).toHaveCount(0)
  })

  await test.step('after saving normally, closing needs no prompt', async () => {
    const detail = await openCard(page, TITLE)
    await detail.getByLabel('Description').fill('Saved with the button')
    await detail.getByRole('button', { name: 'Save changes' }).click()
    await expect(detail.getByText('Saved', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: 'Close' }).first().click()
    await expect(detail).toHaveCount(0)
    await expect(prompt(page)).toHaveCount(0)
  })
})
