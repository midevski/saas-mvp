import { expect, test, type Page } from '@playwright/test'

// The show/hide password toggle on the login and register forms.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

function passwordField(page: Page) {
  return page.getByLabel('Password', { exact: true })
}

async function expectToggleWorks(page: Page) {
  const field = passwordField(page)
  await field.fill('s3cret-pass')
  await expect(field).toHaveAttribute('type', 'password') // hidden by default

  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(field).toHaveAttribute('type', 'text')
  await expect(field).toHaveValue('s3cret-pass')
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  // Clicking the eye doesn't steal focus — typing carries on in the field
  await expect(field).toBeFocused()
  await page.keyboard.type('!')
  await expect(field).toHaveValue('s3cret-pass!')

  await page.getByRole('button', { name: 'Hide password' }).click()
  await expect(field).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false')
}

test('login: the eye button shows and hides the password', async ({ page }) => {
  await page.goto('/login')
  await expectToggleWorks(page)
})

test('register: the eye button shows and hides the password, and signing up still works', async ({ page }) => {
  await page.goto('/register')
  await expectToggleWorks(page)

  // Submitting while the password is visible works, and hides it again on submit
  await page.getByRole('button', { name: 'Show password' }).click()
  await page.getByLabel('Name').fill('Eye Tester')
  await page.getByLabel('Email').fill(`eye-${runId}@e2e.test`)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome, Eye Tester' })).toBeVisible()
})
