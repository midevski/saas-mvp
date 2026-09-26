import { orgRoom } from './events'
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

// Reads the X-Socket-Id header a client sends with REST calls (bounded; ignored if malformed)
export function requesterSocketId(header: string | undefined): string | undefined {
  return header && /^[\w-]{1,64}$/.test(header) ? header : undefined
}
