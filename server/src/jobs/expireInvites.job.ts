import { Invite } from '../modules/orgs/invite.model'

type Log = (message: string) => void

// Marks invites that are past their expiresAt and still pending as expired.
// Accepted (or already expired) invites are never touched.
export async function expireInvites(log: Log = () => {}, now: Date = new Date()) {
  const result = await Invite.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired' } },
  )

  log(`marked ${result.modifiedCount} stale invite(s) as expired`)
  return { expiredCount: result.modifiedCount }
}
