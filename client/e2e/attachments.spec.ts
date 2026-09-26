import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'
import { activateSubscription } from './support/db'

// Card images: upload from the detail view, see them live on another user's board, delete with
// confirmation. Server-side enforcement is covered in server/src/modules/board/board.test.ts.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Attach Org ${runId}`
const cardTitle = `Moodboard ${runId}`

// A real 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

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

function cardOnBoard(page: Page) {
  return page.locator('.board-card', { hasText: cardTitle })
}

function uploadRequests(page: Page) {
  const sent: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/attachments')) sent.push(req.url())
  })
  return sent
}

async function openBoard(page: Page, user: TestUser) {
  await logIn(page, user)
  await page.goto(`/orgs/${orgId}/board`)
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
}

test('card images: validate, upload with progress, live on other boards, preview, delete', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await openBoard(a, owner)
  await openBoard(b, member)

  const todo = a.locator('.board-column', { has: a.getByRole('heading', { name: 'To Do', exact: true }) })
  await todo.getByPlaceholder('Add a card...').fill(cardTitle)
  await todo.getByRole('button', { name: 'Add' }).click()
  await expect(cardOnBoard(b)).toBeVisible()

  // Clicking the card opens its detail view
  await cardOnBoard(a).getByRole('button', { name: cardTitle }).click()
  const detail = a.getByRole('dialog', { name: cardTitle })
  await expect(detail).toBeVisible()
  const fileInput = detail.getByLabel('Add image')
  const sent = uploadRequests(a)

  await test.step('non-image files are rejected client-side, before any request', async () => {
    await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(detail.getByRole('alert')).toHaveText(`"notes.txt" isn't a supported image. Use JPEG, PNG, WebP or GIF.`)
    await fileInput.setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
    await expect(detail.getByRole('alert')).toContainText('"doc.pdf" isn\'t a supported image')
    expect(sent).toHaveLength(0)
  })

  await test.step('oversized images are rejected client-side, before any request', async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)])
    await fileInput.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: huge })
    await expect(detail.getByRole('alert')).toHaveText('"huge.png" is 5.0 MB. Images must be 5 MB or smaller.')
    expect(sent).toHaveLength(0)
  })

  await test.step('a valid image shows a loading state, then its thumbnail', async () => {
    // Slow the upload down so the in-progress state is observable
    await a.route('**/attachments', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    await fileInput.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: PNG })
    await expect(detail.getByRole('status').filter({ hasText: 'Uploading' })).toContainText('first.png')
    await expect(detail.getByRole('button', { name: 'View first.png' })).toBeVisible()
    await expect(detail.getByRole('status').filter({ hasText: 'Uploading' })).toHaveCount(0)
    await expect(detail.getByRole('alert')).toHaveCount(0)
    await a.unroute('**/attachments')
    expect(sent).toHaveLength(1)
  })

  await test.step('the other user sees it on the card face without refreshing', async () => {
    await expect(cardOnBoard(b).locator('img.board-card-cover')).toBeVisible()
    await expect(cardOnBoard(b).getByLabel('1 image')).toBeVisible()
    // And the uploader's own board face too
    await expect(cardOnBoard(a).getByLabel('1 image')).toBeVisible()
  })

  await test.step('a second image updates the count live', async () => {
    await fileInput.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: PNG })
    await expect(detail.getByRole('button', { name: 'View second.png' })).toBeVisible()
    await expect(cardOnBoard(b).getByLabel('2 images')).toBeVisible()
  })

  await test.step('clicking a thumbnail opens a full-size preview', async () => {
    await detail.getByRole('button', { name: 'View first.png' }).click()
    const lightbox = a.getByRole('dialog', { name: 'first.png' })
    await expect(lightbox.getByRole('img', { name: 'first.png' })).toBeVisible()
    await a.keyboard.press('Escape')
    await expect(lightbox).toHaveCount(0)
    await expect(detail).toBeVisible() // only the preview closed
  })

  await test.step('deleting asks for confirmation, then removes it everywhere and from storage', async () => {
    const secondUrl = await detail.getByRole('img', { name: 'second.png' }).getAttribute('src')

    await detail.getByRole('button', { name: 'View second.png' }).hover()
    await detail.getByRole('button', { name: 'Delete second.png' }).click()
    const confirm = a.getByRole('dialog', { name: 'Delete this image?' })
    await expect(confirm).toContainText('second.png will be removed from this card for everyone')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(detail.getByRole('button', { name: 'View second.png' })).toBeVisible()

    await detail.getByRole('button', { name: 'Delete second.png' }).click()
    await a.getByRole('dialog', { name: 'Delete this image?' }).getByRole('button', { name: 'Delete image' }).click()
    await expect(detail.getByRole('button', { name: 'View second.png' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'View first.png' })).toBeVisible()
    await expect(cardOnBoard(b).getByLabel('1 image')).toBeVisible()

    // Gone from storage too, not just from the card
    expect((await a.request.get(secondUrl!)).status()).toBe(404)
  })

  await a.context().close()
  await b.context().close()
})
