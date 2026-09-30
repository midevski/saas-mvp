import { orgRoom, userRoom } from './events'
import type { AppServer } from './socket'

// Lets REST handlers (e.g. attachment uploads, which arrive over HTTP) push realtime events to
// an org's board room. Set once by createSocketServer; a no-op when no socket server exists.
let io: AppServer | null = null

export function setRealtimeServer(server: AppServer | null) {
  io = server
}

// `exceptSocketId`: the requesting browser's own socket (sent as X-Socket-Id). It already has
// the result from the HTTP response, and receiving its own broadcast mid-way through a burst
// of quick changes would briefly undo its optimistic updates.
export function emitToOrg(orgId: string, event: string, payload: unknown, exceptSocketId?: string) {
  if (!io) return
  const room = io.to(orgRoom(orgId))
  ;(exceptSocketId ? room.except(exceptSocketId) : room).emit(event, payload)
}

// Reach specific people wherever they are in the app (see userRoom)
export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io || userIds.length === 0) return
  io.to(userIds.map(userRoom)).emit(event, payload)
}

// Take every socket out of an org's board room (e.g. the org was deleted)
export function closeOrgRoom(orgId: string) {
  io?.in(orgRoom(orgId)).socketsLeave(orgRoom(orgId))
}

// Reads the X-Socket-Id header a client sends with REST calls (bounded; ignored if malformed)
export function requesterSocketId(header: string | undefined): string | undefined {
  return header && /^[\w-]{1,64}$/.test(header) ? header : undefined
}
