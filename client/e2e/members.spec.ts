import { expect, test, type Page } from '@playwright/test'
import { addMember, createOrg, logIn, registerUser, type TestUser } from './support/api'

// Changing a member's role or removing them must be confirmed first — the first click alone
// changes nothing.

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const orgName = `Members Org ${runId}`

let owner: TestUser
let member: TestUser
let removable: TestUser

test.beforeAll(async ({ request }) => {
  owner = await registerUser(request, 'Owen Owner', `owner-${runId}@e2e.test`)
  member = await registerUser(request, 'Sam Member', `sam-${runId}@e2e.test`)
  removable = await registerUser(request, 'Riley Remove', `riley-${runId}@e2e.test`)
  const orgId = await createOrg(request, owner, orgName)
  await addMember(request, orgId, owner, member, 'member')
  await addMember(request, orgId, owner, removable, 'member')
})

function roleSelect(page: Page) {
  return page.getByRole('combobox', { name: `Role for ${member.name}` })
}

async function expectSavedRole(page: Page, role: 'member' | 'admin') {
  // Reload so the check reflects what the server stored, not just local UI state
  await page.reload()
  await expect(roleSelect(page)).toHaveValue(role)
}

test('role changes require confirmation; cancelling leaves the role unchanged', async ({ page }) => {
  await logIn(page, owner)
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible()
  await expect(roleSelect(page)).toHaveValue('member')

  await test.step('picking a role opens a confirmation instead of saving', async () => {
    await roleSelect(page).selectOption('admin')
    const dialog = page.getByRole('dialog', { name: `Change ${member.name}'s role?` })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`${member.name} will go from member to admin in ${orgName}.`)
    // The dropdown still shows the saved role while the change is pending
    await expect(roleSelect(page)).toHaveValue('member')
  })

  await test.step('Cancel keeps the current role', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(roleSelect(page)).toHaveValue('member')
    await expectSavedRole(page, 'member')
  })

  await test.step('Escape also cancels', async () => {
    await roleSelect(page).selectOption('admin')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectSavedRole(page, 'member')
  })

  await test.step('confirming saves the new role', async () => {
    await roleSelect(page).selectOption('admin')
    await page.getByRole('dialog').getByRole('button', { name: 'Make admin' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(roleSelect(page)).toHaveValue('admin')
    await expectSavedRole(page, 'admin')
  })

  await test.step('demoting is confirmed the same way', async () => {
    await roleSelect(page).selectOption('member')
    const dialog = page.getByRole('dialog', { name: `Change ${member.name}'s role?` })
    await expect(dialog).toContainText("They'll no longer be able to invite people or remove members.")
    await dialog.getByRole('button', { name: 'Make member' }).click()
    await expectSavedRole(page, 'member')
  })
})

test('removing a member requires confirmation; cancelling keeps them', async ({ page }) => {
  await logIn(page, owner)
  await expect(page.getByRole('heading', { level: 1, name: orgName })).toBeVisible()

  const members = page.locator('section', { has: page.getByRole('heading', { name: 'Members' }) })
  const row = members.getByRole('listitem').filter({ hasText: removable.email })
  const dialogTitle = `Remove ${removable.name} from ${orgName}?`

  await test.step('Remove opens a confirmation instead of removing', async () => {
    await row.getByRole('button', { name: 'Remove' }).click()
    const dialog = page.getByRole('dialog', { name: dialogTitle })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`${removable.name} (${removable.email}) will lose access to ${orgName}`)
    await expect(dialog).toContainText('send them a new invite')
  })

  await test.step('Cancel and Escape keep the member', async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await row.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByRole('dialog', { name: dialogTitle })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Reload: still a member according to the server
    await page.reload()
    await expect(row).toBeVisible()
  })

  await test.step('confirming removes them', async () => {
    await row.getByRole('button', { name: 'Remove' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row).toHaveCount(0)

    await page.reload()
    await expect(members.getByText(member.email)).toBeVisible() // list has loaded
    await expect(row).toHaveCount(0)
  })
})
