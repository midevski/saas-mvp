import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root, where docker-compose.yml lives
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const DB_NAME = process.env.E2E_MONGO_DB ?? 'saas-mvp'

// Runs a mongosh script inside the compose stack's mongo container — the same database the
// server under test uses. Only for test setup that has no user-facing path in the E2E flow.
function mongosh(script: string) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'mongo', 'mongosh', DB_NAME, '--quiet', '--eval', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
}

// Stands in for a completed Stripe Checkout. Driving real hosted Checkout would also need the
// Stripe CLI forwarding webhooks into CI — brittle for no extra confidence: signature checks and
// webhook -> subscription sync are covered by server/src/modules/billing/billing.test.ts.
// This writes exactly what the checkout.session.completed webhook handler would.
export function activateSubscription(orgId: string) {
  if (!/^[a-f\d]{24}$/i.test(orgId)) throw new Error(`Not an ObjectId: ${orgId}`)
  mongosh(`
    db.subscriptions.updateOne(
      { orgId: ObjectId('${orgId}') },
      { $set: {
          stripeCustomerId: 'cus_e2e_${orgId}',
          stripeSubscriptionId: 'sub_e2e_${orgId}',
          status: 'active',
          priceId: 'price_e2e',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          updatedAt: new Date(),
      } },
      { upsert: true },
    )
  `)
}
