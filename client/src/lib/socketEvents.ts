// Socket.io event names — mirrors server/src/realtime/events.ts

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
// { onlineUserIds: string[] } — who has this org's board open right now
export const PRESENCE_UPDATE = 'presence:update'

// connect_error message when the handshake token is missing/invalid/expired
export const UNAUTHORIZED = 'unauthorized'

// Live cursors. Pixels relative to the board's content track; null x/y = left the board.
// Client -> server: { orgId, x, y }
export const CURSOR_MOVE = 'cursor:move'
// Server -> others in the room: { userId, x, y }
export const CURSOR_UPDATE = 'cursor:update'
