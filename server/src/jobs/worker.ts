import { Worker, type Job } from 'bullmq'
import { env } from '../config/env'
import { expireInvites } from './expireInvites.job'
import { JOB_NAMES, QUEUE_NAME } from './queue'
import { sendWelcomeEmail, type WelcomeEmailData } from './welcomeEmail.job'

// Every log line carries the job name and id, so a log stream alone tells the whole story
function jobLabel(job: Job) {
  return `${job.name} #${job.id}`
}

function logFor(job: Job) {
  return (message: string) => console.log(`[jobs]          ${jobLabel(job)}: ${message}`)
}

async function processJob(job: Job) {
  const log = logFor(job)
  switch (job.name) {
    case JOB_NAMES.WELCOME_EMAIL:
      return sendWelcomeEmail(job.data as WelcomeEmailData, log)
    case JOB_NAMES.EXPIRE_INVITES:
      return expireInvites(log)
    default:
      throw new Error(`No handler registered for job "${job.name}"`)
  }
}

let worker: Worker | null = null

// Runs in the API server's process for this project's scope — see README "Future work"
export function startWorker(): Worker {
  if (worker) return worker

  worker = new Worker(QUEUE_NAME, processJob, { connection: { url: env.REDIS_URL } })

  worker.on('active', (job) => console.log(`[jobs] started   ${jobLabel(job)}`))
  worker.on('completed', (job) => {
    const ms = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0
    console.log(`[jobs] completed ${jobLabel(job)} in ${ms}ms`)
  })
  worker.on('failed', (job, err) => {
    const label = job ? `${jobLabel(job)} (attempt ${job.attemptsMade})` : 'unknown job'
    console.error(`[jobs] failed    ${label}: ${err.message}`)
  })
  worker.on('error', (err) => console.error(`[jobs] worker connection error: ${err.message}`))
  worker.on('ready', () => console.log(`[jobs] worker ready, listening on queue "${QUEUE_NAME}"`))

  return worker
}

// Lets an in-flight job finish before shutdown, so a restart doesn't cut one off mid-run.
// Queued jobs live in Redis either way and are picked up after the restart.
export async function closeWorker() {
  await worker?.close()
  worker = null
}
