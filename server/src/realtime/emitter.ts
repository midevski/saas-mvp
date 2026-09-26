import { orgRoom } from './events'
import type { AppServer } from './socket'

// Lets REST handlers (e.g. attachment uploads, which arrive over HTTP) push realtime events to
// an org's board room. Set once by createSocketServer; a no-op when no socket server exists.
let io: AppServer | null = null

export function setRealtimeServer(server: AppServer | null) {
  io = server
}

export function emitToOrg(orgId: string, event: string, payload: unknown) {
  io?.to(orgRoom(orgId)).emit(event, payload)
}
