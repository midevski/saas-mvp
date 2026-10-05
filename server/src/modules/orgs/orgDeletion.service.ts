import { cancelAndRemoveSubscription } from '../billing/billing.service'
import { deleteBoardForOrg } from '../board/board.service'
import { deleteNotificationsForOrg } from '../notifications/notification.service'
import { NotFoundError } from '../../lib/errors'
import { Invite } from './invite.model'
import { Membership } from './membership.model'
import { Org } from './org.model'

export interface DeletedOrg {
  orgId: string
  orgName: string
  memberUserIds: string[] // everyone who belonged to it, to notify
}

// Deletes an org and everything that belongs to it. Billing is stopped *first*: if Stripe can't
// cancel the subscription, this throws before anything is deleted. The rest runs in an order
// that leaves the org itself for last, so a failure part-way through can simply be retried.
export async function deleteOrg(orgId: string): Promise<DeletedOrg> {
  const org = await Org.findById(orgId)
  if (!org) throw new NotFoundError('Org not found')
  const memberships = await Membership.find({ orgId }).select('userId')

  await cancelAndRemoveSubscription(orgId)
  await deleteBoardForOrg(orgId)
  await deleteNotificationsForOrg(orgId)
  await Invite.deleteMany({ orgId })
  await Membership.deleteMany({ orgId })
  await Org.deleteOne({ _id: org._id })

  return { orgId, orgName: org.name, memberUserIds: memberships.map((m) => m.userId.toString()) }
}
