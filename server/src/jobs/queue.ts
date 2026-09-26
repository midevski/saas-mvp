import { Queue } from 'bullmq'
import { env } from '../config/env'
import type { WelcomeEmailData } from './welcomeEmail.job'

// One queue for every job type; the job `name` says which handler runs it
export const QUEUE_NAME = 'app-jobs'

export const JOB_NAMES = {
  WELCOME_EMAIL: 'welcome-email',
  EXPIRE_INVITES: 'expire-invites',
} as const

// Created lazily by startQueue() from index.ts rather than at import time, so modules that
// enqueue jobs (e.g. auth.service) can be imported by tests without opening a Redis connection.
let queue: Queue | null = null

export function startQueue(): Queue {
  if (queue) return queue

  queue = new Queue(QUEUE_NAME, {
    // Same REDIS_URL as the rest of the app. enableOfflineQueue: false makes enqueue calls fail
    // fast while Redis is down, instead of silently buffering in memory.
    connection: { url: env.REDIS_URL, enableOfflineQueue: false },
    defaultJobOptions: {
      // Retry/backoff stay at BullMQ defaults (1 attempt) — configurable per job if needed.
      // Only history retention is set, so completed/failed jobs don't pile up in Redis forever.
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  })

  // Reconnect attempts while Redis is down surface here; without a listener they'd crash the process
  queue.on('error', (err) => console.error(`[jobs] queue connection error: ${err.message}`))
  return queue
}

export function getQueue(): Queue | null {
  return queue
}

export async function closeQueue() {
  await queue?.close()
  queue = null
}

// Fire-and-forget by design: callers don't await it, so a slow or unavailable Redis can never
// delay or fail the request that triggered the job (e.g. registration). Failures are logged only.
export function enqueueWelcomeEmail(data: WelcomeEmailData): void {
  if (!queue) return // job system not started (tests, one-off scripts)

  queue
    .add(JOB_NAMES.WELCOME_EMAIL, data)
    .then((job) => console.log(`[jobs] queued   ${JOB_NAMES.WELCOME_EMAIL} #${job.id} for ${data.email}`))
    .catch((err: Error) =>
      console.error(`[jobs] could not queue ${JOB_NAMES.WELCOME_EMAIL} for ${data.email}: ${err.message}`),
    )
}
