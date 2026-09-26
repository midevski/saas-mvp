# saas-mvp

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
