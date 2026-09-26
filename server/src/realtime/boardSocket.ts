import { z } from 'zod'
import { NotFoundError } from '../lib/errors'
import { isOrgSubscribed } from '../modules/billing/billing.service'
import * as boardService from '../modules/board/board.service'
import { findMembership } from '../modules/orgs/org.service'
import {
  BOARD_JOIN,
  BOARD_LEAVE,
  BOARD_STATE,
  CARD_CREATE,
  CARD_CREATED,
  CARD_DELETE,
  CARD_DELETED,
  CARD_MOVE,
  CARD_MOVED,
  CARD_UPDATE,
  CARD_UPDATED,
  orgRoom,
} from './events'
import type { PresenceBroadcaster, PresenceStore } from './presence'
import type { AppSocket } from './socket'

// Sent back to the emitting client via Socket.io acknowledgements
export type AckErrorCode = 'invalid_payload' | 'not_found' | 'subscription_required' | 'internal'
type AckResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; error: AckErrorCode }

class SubscriptionRequiredError extends Error {}

const objectId = z.string().regex(/^[a-f\d]{24}$/i)
const title = z.string().trim().min(1).max(200)

const joinSchema = z.object({ orgId: objectId })
const createSchema = z.object({ boardId: objectId, columnId: objectId, title })
const moveSchema = z.object({ cardId: objectId, toColumnId: objectId, toOrder: z.number().int().min(0) })
const updateSchema = z
  .object({
    cardId: objectId,
    title: title.optional(),
    description: z.string().max(5000).nullable().optional(),
  })
  .refine((d) => d.title !== undefined || d.description !== undefined, 'Nothing to update')
const deleteSchema = z.object({ cardId: objectId })

// Re-run on every incoming event: the REST API's access control (membership + subscription)
// must not be bypassable just because a socket was allowed in earlier.
async function assertCanAccessOrg(userId: string, orgId: string | null): Promise<string> {
  // Non-member and nonexistent org look identical, same as requireRole's 404
  if (!orgId || !(await findMembership(orgId, userId))) throw new NotFoundError('Not found')
  if (!(await isOrgSubscribed(orgId))) throw new SubscriptionRequiredError()
  return orgId
}

function handler<T>(schema: z.ZodType<T>, fn: (payload: T) => Promise<Record<string, unknown>>) {
  return async (raw: unknown, ack?: unknown) => {
    const reply = (res: AckResponse) => {
      if (typeof ack === 'function') ack(res)
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      reply({ ok: false, error: 'invalid_payload' })
      return
    }

    try {
      reply({ ok: true, ...(await fn(parsed.data)) })
    } catch (err) {
      if (err instanceof NotFoundError) reply({ ok: false, error: 'not_found' })
      else if (err instanceof SubscriptionRequiredError) reply({ ok: false, error: 'subscription_required' })
      else {
        console.error('[socket] handler failed:', err)
        reply({ ok: false, error: 'internal' })
      }
    }
  }
}

export function registerBoardHandlers(
  socket: AppSocket,
  presence: PresenceStore,
  broadcaster: PresenceBroadcaster,
) {
  const { userId } = socket.data.user

  // Everyone in the room — including the socket that triggered the change — gets the new list
  const broadcastPresence = (orgId: string) => broadcaster.broadcast(orgId)

  // Presence is best-effort: a Redis hiccup must never break joining or using the board
  async function safely(action: string, fn: () => Promise<void>) {
    try {
      await fn()
    } catch (err) {
      console.error(`[presence] ${action} failed: ${(err as Error).message}`)
    }
  }

  // Join/leave/disconnect for this socket run strictly in order. Handlers are async, so without
  // this a join still awaiting the DB could finish *after* a leave or disconnect and re-add
  // presence for a socket that's already gone.
  let pending: Promise<unknown> = Promise.resolve()
  function inOrder<T>(fn: () => Promise<T>): Promise<T> {
    const run = pending.then(fn, fn)
    pending = run.catch(() => {})
    return run
  }

  async function leavePresence() {
    const orgId = socket.data.presenceOrgId
    if (!orgId) return
    delete socket.data.presenceOrgId
    await safely('leave', async () => {
      await presence.remove(orgId, socket.id)
      await broadcastPresence(orgId)
    })
  }

  socket.on(
    BOARD_JOIN,
    handler(joinSchema, ({ orgId }) => inOrder(async () => {
      await assertCanAccessOrg(userId, orgId)

      // A client views one org's board at a time
      for (const room of socket.rooms) {
        if (room.startsWith('org:') && room !== orgRoom(orgId)) await socket.leave(room)
      }
      if (socket.data.presenceOrgId !== orgId) await leavePresence()
      await socket.join(orgRoom(orgId))

      // Full snapshot to the joining client only, so a mid-session (re)connect isn't stale
      socket.emit(BOARD_STATE, await boardService.getBoardState(orgId))

      socket.data.presenceOrgId = orgId
      await safely('join', async () => {
        await presence.add(orgId, socket.id, userId)
        await broadcastPresence(orgId)
      })
      return {}
    })),
  )

  // The socket connection lives app-wide, so leaving the board page is an explicit event
  socket.on(
    BOARD_LEAVE,
    handler(z.unknown(), () => inOrder(async () => {
      for (const room of socket.rooms) {
        if (room.startsWith('org:')) await socket.leave(room)
      }
      await leavePresence()
      return {}
    })),
  )

  // Closed tab, dropped network, logout. Other tabs of the same user keep their own entries,
  // so the user only goes offline once their last socket for that org is gone.
  socket.on('disconnect', () => void inOrder(leavePresence))

  // Card events: the orgId to check is always derived from the DB record, never from the client.
  // Broadcasts use socket.to(), which excludes the sender — their UI already updated optimistically.

  socket.on(
    CARD_CREATE,
    handler(createSchema, async ({ boardId, columnId, title }) => {
      const orgId = await assertCanAccessOrg(userId, await boardService.getOrgIdForBoard(boardId))
      const card = await boardService.createCard(boardId, columnId, title, userId)
      socket.to(orgRoom(orgId)).emit(CARD_CREATED, { card })
      return { card }
    }),
  )

  socket.on(
    CARD_MOVE,
    handler(moveSchema, async ({ cardId, toColumnId, toOrder }) => {
      const orgId = await assertCanAccessOrg(userId, await boardService.getOrgIdForCard(cardId))
      const result = await boardService.moveCard(cardId, toColumnId, toOrder)
      socket.to(orgRoom(orgId)).emit(CARD_MOVED, { cardId, toColumnId, toOrder: result.toOrder })
      return { toOrder: result.toOrder }
    }),
  )

  socket.on(
    CARD_UPDATE,
    handler(updateSchema, async ({ cardId, title, description }) => {
      const orgId = await assertCanAccessOrg(userId, await boardService.getOrgIdForCard(cardId))
      const card = await boardService.updateCard(cardId, { title, description })
      socket.to(orgRoom(orgId)).emit(CARD_UPDATED, { card })
      return { card }
    }),
  )

  socket.on(
    CARD_DELETE,
    handler(deleteSchema, async ({ cardId }) => {
      const orgId = await assertCanAccessOrg(userId, await boardService.getOrgIdForCard(cardId))
      const deleted = await boardService.deleteCard(cardId)
      socket.to(orgRoom(orgId)).emit(CARD_DELETED, deleted)
      return {}
    }),
  )
}
