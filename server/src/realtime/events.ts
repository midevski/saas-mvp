// Socket.io event names — mirrored in client/src/lib/socketEvents.ts

// Client -> server
export const BOARD_JOIN = 'board:join'
export const BOARD_LEAVE = 'board:leave'
export const CARD_CREATE = 'card:create'
export const CARD_MOVE = 'card:move'
export const CARD_UPDATE = 'card:update'
export const CARD_DELETE = 'card:delete'

// Server -> client
export const BOARD_STATE = 'board:state'
export const CARD_CREATED = 'card:created'
export const CARD_MOVED = 'card:moved'
export const CARD_UPDATED = 'card:updated'
export const CARD_DELETED = 'card:deleted'
// { onlineUserIds: string[] } — everyone in the room, whenever board presence changes
export const PRESENCE_UPDATE = 'presence:update'

// connect_error message when the handshake token is missing/invalid/expired
export const UNAUTHORIZED = 'unauthorized'

export function orgRoom(orgId: string) {
  return `org:${orgId}`
}
