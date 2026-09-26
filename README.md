# saas-mvp

[![CI](https://github.com/midevski/saas-mvp/actions/workflows/ci.yml/badge.svg)](https://github.com/midevski/saas-mvp/actions/workflows/ci.yml)

## Testing

| Layer | Tool | Run it | Covers |
| --- | --- | --- | --- |
| Unit / integration | Jest + Supertest + `mongodb-memory-server` | `cd server && npm test` | Every module: auth, orgs/RBAC, billing webhooks, board + socket permissions, jobs |
| End-to-end | Playwright (Chromium) | `cd client && npx playwright test` | The critical path in a real browser, with two users |

**The E2E test** (`client/e2e/critical-path.spec.ts`) is deliberately one thorough journey rather than many small tests. It goes: register → create an org → invite a second user (in a second browser context) → subscribe → both users open the board. It then checks that a card created by one user appears for the other, and that a move by the other shows up for the first, **without a page reload**, so real Socket.io delivery is exercised end to end.

- **It runs against the full `docker compose` stack**, not a Playwright `webServer`, because the app needs Mongo and Redis too. Start the stack first:
  ```
  docker compose up -d --build
  cd client && npx playwright test          # E2E_BASE_URL overrides http://localhost:5173
  ```
- **Subscription is set in the database, not through Stripe Checkout.** Checkout needs the Stripe CLI forwarding webhooks into the test environment, which is brittle in CI. The webhook → subscription path is covered by `billing.test.ts`. The E2E test writes the same record that webhook would (`e2e/support/db.ts`).
- **No cleanup needed.** Every run uses unique emails, and CI starts from fresh containers.

**CI** (`.github/workflows/ci.yml`) runs on every push and PR to `main`:
- `server-tests` and `client-lint-build` run in parallel.
- `e2e` runs only once both pass, and uploads the Playwright HTML report (with traces, screenshots and video on failure) as an artifact.
- `docker-build` checks that both images build.
- It needs these repository secrets (test-mode values only): `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`.

## Background jobs

Asynchronous work runs on a BullMQ queue (`app-jobs`) backed by the same Redis instance the app already uses. Code lives in `server/src/jobs/`.

| Job | Trigger | What it does |
| --- | --- | --- |
| `welcome-email` | Enqueued after `POST /auth/register` | Renders the welcome email and **logs** it instead of sending (see below) |
| `expire-invites` | Repeating schedule, every 15 min (`*/15 * * * *`) | Marks `pending` invites whose `expiresAt` has passed as `expired` |

- **Registration never waits on the queue.** The enqueue is fire-and-forget: if Redis is unavailable, the failure is logged and registration still succeeds.
- **Schedules don't duplicate on restart.** `expire-invites` is registered on boot with `queue.upsertJobScheduler` (BullMQ 6 removed `repeat` from `queue.add`). It is keyed by id, so each boot updates the single existing schedule.
- **Queued work survives restarts.** Jobs live in Redis, and on shutdown the worker lets an in-flight job finish first.
- **Logs tell the story.** Every worker log line includes the job name and id, e.g. `[jobs] completed welcome-email #2 in 2ms`.
- Retry/backoff use BullMQ defaults (one attempt). They're configurable per job, and deliberately left alone at this scale.

**Email delivery is stubbed on purpose.** No email provider is configured, so the welcome-email worker logs the subject and body it *would* send. The queueing and async processing are real; only the final provider call is missing, and it plugs in at one marked spot in `welcomeEmail.job.ts`. The same applies to org invites, which currently show a shareable link instead of sending an email.

## Future work

- **Transactional email provider** (Resend, SendGrid, …) for welcome emails and org invites.
- **Separate worker process/container.** Jobs currently run inside the API server process, which is fine at this scale. In production the worker would run as its own dyno/container, so jobs and HTTP traffic scale independently.
- **Queue dashboard.** `@bull-board/express` could show queued/completed/failed jobs at a route like `/admin/queues`. It would need cookie- or session-based admin auth, since browser navigation doesn't send the bearer token `requireAuth` expects.
