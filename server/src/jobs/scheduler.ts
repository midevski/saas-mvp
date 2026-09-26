import { JOB_NAMES, startQueue } from './queue'

// Every 15 minutes so it's quick to see in a demo; production would more likely run hourly or daily
const EXPIRE_INVITES_PATTERN = '*/15 * * * *'

// BullMQ 6 removed the `repeat` option from queue.add(); repeating work is registered with
// upsertJobScheduler instead. It's keyed by the scheduler id, so calling it on every boot
// updates the one existing schedule rather than adding a duplicate.
export async function registerSchedules() {
  const queue = startQueue()

  await queue.upsertJobScheduler(
    JOB_NAMES.EXPIRE_INVITES,
    { pattern: EXPIRE_INVITES_PATTERN },
    { name: JOB_NAMES.EXPIRE_INVITES, data: {} },
  )

  const schedulers = await queue.getJobSchedulers()
  console.log(`[jobs] ${schedulers.length} repeating schedule(s) registered:`)
  for (const s of schedulers) {
    const next = s.next ? new Date(s.next).toISOString() : 'unknown'
    console.log(`[jobs]   - ${s.name} (${s.pattern ?? `every ${s.every}ms`}), next run at ${next}`)
  }
}
