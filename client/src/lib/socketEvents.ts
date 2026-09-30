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

// Columns. Adding, renaming and deleting are shared; order and collapse are each viewer's own
// layout, kept in this browser and never sent. Client -> server:
export const COLUMN_CREATE = 'column:create' // { boardId, name }
export const COLUMN_UPDATE = 'column:update' // { columnId, name }
export const COLUMN_DELETE = 'column:delete' // { columnId, moveCardsTo? }
// Server -> others in the room:
export const COLUMN_CREATED = 'column:created' // { column }
export const COLUMN_UPDATED = 'column:updated' // { column }
export const COLUMN_DELETED = 'column:deleted' // { columnId, movedCards? | deletedCardIds? }

// Sent to every member of an org, wherever they are in the app, when its owner deletes it:
// { orgId, orgName }
export const ORG_DELETED = 'org:deleted'
