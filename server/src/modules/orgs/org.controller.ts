import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { env } from '../../config/env'
import { paramAsString } from '../../lib/params'
import * as orgService from './org.service'

const createOrgSchema = z.object({ name: z.string().trim().min(1).max(100) })
const inviteSchema = z.object({ email: z.string().email(), role: z.enum(['admin', 'member']) })
const updateRoleSchema = z.object({ role: z.enum(['admin', 'member']) })

function toPublicOrg(org: { id: string; name: string; slug: string }) {
  return { id: org.id, name: org.name, slug: org.slug }
}

export async function createOrgHandler(req: Request, res: Response) {
  const parsed = createOrgSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const org = await orgService.createOrg(req.user!.userId, parsed.data.name)
  res.status(201).json({ org: toPublicOrg(org), role: 'owner' })
}

export async function listOrgsHandler(req: Request, res: Response) {
  const orgs = await orgService.getOrgsForUser(req.user!.userId)
  res.json({ orgs })
}

export async function getMembersHandler(req: Request, res: Response) {
  const members = await orgService.getMembers(paramAsString(req.params.orgId)!)
  res.json({ members })
}

export async function inviteHandler(req: Request, res: Response) {
  const parsed = inviteSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const invite = await orgService.inviteMember(
    paramAsString(req.params.orgId)!,
    req.user!.userId,
    parsed.data.email,
    parsed.data.role,
  )
  res.status(201).json({
    inviteToken: invite.token,
    // No email delivery yet (Future work) — surface the link directly for manual testing
    inviteLink: `${env.CLIENT_URL}/invites/${invite.token}`,
    expiresAt: invite.expiresAt,
  })
}

export async function acceptInviteHandler(req: Request, res: Response) {
  const orgId = await orgService.acceptInvite(
    paramAsString(req.params.token)!,
    req.user!.userId,
    req.user!.email,
  )
  res.json({ orgId })
}

export async function removeMemberHandler(req: Request, res: Response) {
  const targetUserId = paramAsString(req.params.userId)
  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
    res.status(400).json({ error: 'Invalid user id' })
    return
  }

  await orgService.removeMember(paramAsString(req.params.orgId)!, req.user!.userId, targetUserId)
  res.status(204).end()
}

export async function updateRoleHandler(req: Request, res: Response) {
  const targetUserId = paramAsString(req.params.userId)
  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) {
    res.status(400).json({ error: 'Invalid user id' })
    return
  }

  const parsed = updateRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body' })
    return
  }

  const membership = await orgService.updateMemberRole(
    paramAsString(req.params.orgId)!,
    req.user!.userId,
    targetUserId,
    parsed.data.role,
  )
  res.json({ userId: membership.userId.toString(), role: membership.role })
}
