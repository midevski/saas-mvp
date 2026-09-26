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
  CURSOR_MOVE,
  CURSOR_UPDATE,
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
// Pixels relative to an anchor chosen by `area`: 'board' = the board's content track (scrolls
// with the columns), 'column' = one column's card list content (each list scrolls on its own),
// 'page' = the board page container (header, gaps, margins — can be negative, e.g. in the left
// margin). null/null hides the cursor (pointer left the window).
const coordinate = z.number().finite().min(-5_000).max(20_000)
const cursorSchema = z.union([
  z.object({ orgId: objectId, x: coordinate, y: coordinate, area: z.enum(['board', 'page']) }),
  z.object({ orgId: objectId, x: coordinate, y: coordinate, area: z.literal('column'), columnId: objectId }),
  z.object({ orgId: objectId, x: z.null(), y: z.null() }),
])

const CURSOR_MIN_INTERVAL_MS = 15
const CURSOR_RECHECK_MS = 10_000

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

  // Live cursors: a hot path (~25 msgs/sec per user), relayed without touching the database
  // except for a periodic permission re-check. Nothing is ever persisted.
  let lastCursorAt = 0
  let cursorVerifiedAt = 0
  let cursorVerifiedOrg: string | null = null

  socket.on(CURSOR_MOVE, async (raw: unknown) => {
    const parsed = cursorSchema.safeParse(raw)
    if (!parsed.success) return
    const { orgId, x, y } = parsed.data
    const area = 'area' in parsed.data ? parsed.data.area : null
    const columnId = 'columnId' in parsed.data ? parsed.data.columnId : undefined

    // Must have joined this org's board (which checked membership + subscription)
    if (socket.data.presenceOrgId !== orgId || !socket.rooms.has(orgRoom(orgId))) return

    // Drop floods: clients throttle to ~25/sec, so anything much faster is misbehaving
    const now = Date.now()
    if (now - lastCursorAt < CURSOR_MIN_INTERVAL_MS) return
    lastCursorAt = now

    // Re-verify against the DB periodically rather than on every message
    if (cursorVerifiedOrg !== orgId || now - cursorVerifiedAt > CURSOR_RECHECK_MS) {
      try {
        await assertCanAccessOrg(userId, orgId)
        cursorVerifiedOrg = orgId
        cursorVerifiedAt = now
      } catch {
        return
      }
    }

    // userId comes from the authenticated socket, never the payload. `volatile`: a client that
    // can't keep up just skips stale positions instead of queueing them.
    socket
      .to(orgRoom(orgId))
      .volatile.emit(CURSOR_UPDATE, { userId, x, y, area, ...(columnId ? { columnId } : {}) })
  })

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
