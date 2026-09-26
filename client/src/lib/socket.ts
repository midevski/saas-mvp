import { io, type Socket } from 'socket.io-client'
import { getAccessToken, refreshAccessTokenOnce } from './api/axiosInstance'
import { UNAUTHORIZED } from './socketEvents'

// Same origin — Vite proxies /socket.io to the server (see vite.config.ts).
// SocketContext drives connect/disconnect from the auth state.
export const socket: Socket = io({
  autoConnect: false,
  // A function, not a static object: re-evaluated on every (re)connect, so the handshake
  // always carries the latest access token rather than the one from initial page load
  auth: (cb) => cb({ token: getAccessToken() }),
})

// Access tokens expire every 15 min. If a reconnect's handshake is rejected for that reason,
// refresh once and retry — the server rejecting auth stops Socket.io's own auto-reconnect.
let refreshedSinceLastConnect = false

socket.on('connect', () => {
  refreshedSinceLastConnect = false
})

socket.on('connect_error', async (err) => {
  if (err.message !== UNAUTHORIZED || refreshedSinceLastConnect) return
  refreshedSinceLastConnect = true
  const token = await refreshAccessTokenOnce()
  if (token) socket.connect()
})
