import type http from 'http'
import { createAdapter } from '@socket.io/redis-adapter'
import type Redis from 'ioredis'
import { Server, type Socket } from 'socket.io'
import { env } from '../config/env'
import type { AuthPayload } from '../middleware/requireAuth'
import { verifyAccessToken } from '../modules/auth/auth.service'
import { registerBoardHandlers } from './boardSocket'
import { setRealtimeServer } from './emitter'
import { orgRoom, PRESENCE_UPDATE, UNAUTHORIZED, userRoom } from './events'
import { MemoryPresenceStore, PresenceBroadcaster, RedisPresenceStore, type PresenceStore } from './presence'

export interface SocketData {
  user: AuthPayload
  // The org whose board this socket currently counts as viewing (for presence)
  presenceOrgId?: string
}

// Event payloads are validated at runtime with zod in boardSocket.ts, so the maps stay loose
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseEvents = Record<string, (...args: any[]) => void>
export type AppServer = Server<LooseEvents, LooseEvents, LooseEvents, SocketData>
export type AppSocket = Socket<LooseEvents, LooseEvents, LooseEvents, SocketData>

// `redis` is optional so tests can run on the in-memory adapter and presence store
export function createSocketServer(
  httpServer: http.Server,
  redis?: Redis,
): { io: AppServer; closePresence: () => Promise<void> } {
  const io: AppServer = new Server(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  })

  if (redis) {
    // Redis-backed rooms/broadcasts, so multiple server instances share one realtime state
    io.adapter(createAdapter(redis, redis.duplicate()))
  }
  // REST handlers broadcast through this (e.g. attachment uploads -> card:updated)
  setRealtimeServer(io)

  const presence: PresenceStore = redis ? new RedisPresenceStore(redis) : new MemoryPresenceStore()
  const broadcaster = new PresenceBroadcaster(presence, (orgId, onlineUserIds) =>
    io.to(orgRoom(orgId)).emit(PRESENCE_UPDATE, { onlineUserIds }),
  )

  // Handshake auth: the access token arrives in the Socket.io auth payload, not a header
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth?.token
    if (typeof token !== 'string') {
      next(new Error(UNAUTHORIZED))
      return
    }
    try {
      socket.data.user = verifyAccessToken(token)
      next()
    } catch {
      next(new Error(UNAUTHORIZED))
    }
  })

  io.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.user.userId))
    registerBoardHandlers(socket, presence, broadcaster)
  })

  async function closePresence() {
    broadcaster.close()
    await presence.close()
  }

  return { io, closePresence }
}
