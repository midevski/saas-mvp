import crypto from 'crypto'
import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors'
import { User } from '../users/user.model'
import { Org } from './org.model'
import { Membership, type MembershipRole } from './membership.model'
import { Invite, type InviteRole } from './invite.model'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return base || 'org'
}

async function generateUniqueSlug(name: string) {
  const base = slugify(name)
  let slug = base
  let attempts = 0
  while (await Org.exists({ slug })) {
    attempts += 1
    slug = `${base}-${crypto.randomBytes(3).toString('hex')}`
    if (attempts > 5) break
  }
  return slug
}

export async function createOrg(userId: string, name: string) {
  const slug = await generateUniqueSlug(name)

  let org
  try {
    org = await Org.create({ name, slug, ownerId: userId })
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new ConflictError('Org slug already exists, please try again')
    throw err
  }

  await Membership.create({ orgId: org.id, userId, role: 'owner' })
  return org
}

export async function getOrgsForUser(userId: string) {
  const memberships = await Membership.find({ userId })
  const orgs = await Org.find({ _id: { $in: memberships.map((m) => m.orgId) } })
  const orgById = new Map(orgs.map((org) => [org.id, org]))

  return memberships
    .map((m) => {
      const org = orgById.get(m.orgId.toString())
      return org ? { id: org.id, name: org.name, slug: org.slug, role: m.role } : null
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

export async function getMembers(orgId: string) {
  const memberships = await Membership.find({ orgId })
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
  const userById = new Map(users.map((u) => [u.id, u]))

  return memberships.map((m) => {
    const user = userById.get(m.userId.toString())
    return {
      userId: m.userId.toString(),
      role: m.role,
      email: user?.email ?? null,
      name: user?.name ?? null,
    }
  })
}

export async function inviteMember(
  orgId: string,
  invitedByUserId: string,
  email: string,
  role: InviteRole,
) {
  const normalizedEmail = email.toLowerCase().trim()

  const existingUser = await User.findOne({ email: normalizedEmail })
  if (existingUser) {
    const existingMembership = await Membership.findOne({ orgId, userId: existingUser.id })
    if (existingMembership) throw new ConflictError('User is already a member of this org')
  }

  const token = crypto.randomBytes(24).toString('hex')
  return Invite.create({
    orgId,
    email: normalizedEmail,
    role,
    token,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    invitedBy: invitedByUserId,
  })
}

export async function acceptInvite(token: string, userId: string, userEmail: string) {
  const invite = await Invite.findOne({ token })
  if (!invite) throw new NotFoundError('Invite not found')

  const isExpired = invite.status === 'expired' || invite.expiresAt < new Date()
  if (isExpired) {
    if (invite.status === 'pending') {
      invite.status = 'expired'
      await invite.save()
    }
    throw new ForbiddenError('Invite has expired')
  }

  if (invite.status === 'accepted') {
    throw new ForbiddenError('Invite has already been used')
  }

  if (invite.email !== userEmail.toLowerCase()) {
    throw new ForbiddenError('This invite was sent to a different email address')
  }

  const existingMembership = await Membership.findOne({ orgId: invite.orgId, userId })
  if (existingMembership) throw new ConflictError('Already a member of this org')

  await Membership.create({ orgId: invite.orgId, userId, role: invite.role })
  invite.status = 'accepted'
  await invite.save()

  return invite.orgId.toString()
}

export async function removeMember(orgId: string, actingUserId: string, targetUserId: string) {
  const actingMembership = await Membership.findOne({ orgId, userId: actingUserId })
  if (!actingMembership) throw new NotFoundError('Not a member of this org')

  const targetMembership = await Membership.findOne({ orgId, userId: targetUserId })
  if (!targetMembership) throw new NotFoundError('Member not found')

  if (targetMembership.role === 'owner') {
    throw new ForbiddenError('The org owner cannot be removed')
  }

  if (targetMembership.role === 'admin' && actingMembership.role !== 'owner') {
    throw new ForbiddenError('Only the owner can remove an admin')
  }

  await Membership.deleteOne({ _id: targetMembership._id })
}

export async function updateMemberRole(
  orgId: string,
  actingUserId: string,
  targetUserId: string,
  newRole: Exclude<MembershipRole, 'owner'>,
) {
  const actingMembership = await Membership.findOne({ orgId, userId: actingUserId })
  if (!actingMembership || actingMembership.role !== 'owner') {
    throw new ForbiddenError('Only the owner can change roles')
  }

  const targetMembership = await Membership.findOne({ orgId, userId: targetUserId })
  if (!targetMembership) throw new NotFoundError('Member not found')

  if (targetMembership.role === 'owner') {
    throw new ForbiddenError('Ownership cannot be changed or transferred in this phase')
  }

  targetMembership.role = newRole
  await targetMembership.save()
  return targetMembership
}
