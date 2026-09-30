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
// { cardId, entry } — one new comment or system entry for a card's activity feed. Sent to the
// whole room, sender included (clients de-duplicate by entry id). Sent alongside, not instead
// of, the card:updated/card:moved event for the change itself.
export const CARD_ACTIVITY = 'card:activity'
// { cardId, activityId } — a comment was deleted; every open feed removes it
export const CARD_ACTIVITY_DELETED = 'card:activityDeleted'
// Columns. Adding, renaming and deleting are shared; ordering and collapsing are each viewer's
// own layout (stored in their browser) and are never sent. Client -> server:
export const COLUMN_CREATE = 'column:create' // { boardId, name }
export const COLUMN_UPDATE = 'column:update' // { columnId, name } — rename only
export const COLUMN_DELETE = 'column:delete' // { columnId, moveCardsTo? }
// Server -> rest of the room:
export const COLUMN_CREATED = 'column:created' // { column }
export const COLUMN_UPDATED = 'column:updated' // { column }
// { columnId, movedCards? | deletedCardIds? } — one event carries the cards' outcome too, so
// other clients apply the whole deletion atomically rather than through a burst of card events
export const COLUMN_DELETED = 'column:deleted'

// { onlineUserIds: string[] } — everyone in the room, whenever board presence changes
export const PRESENCE_UPDATE = 'presence:update'

// Live cursors — ephemeral, never persisted. Coordinates are pixels relative to the board's
// content track ('board' area) or the board page container ('page' area); null x/y = hidden.
// Client -> server: { orgId, x, y, area: 'board' | 'page' }
export const CURSOR_MOVE = 'cursor:move'
// Server -> rest of the room: { userId, x, y, area } — userId is attached server-side
export const CURSOR_UPDATE = 'cursor:update'

// connect_error message when the handshake token is missing/invalid/expired
export const UNAUTHORIZED = 'unauthorized'

// Server -> every member of an org that was just deleted: { orgId, orgName }
export const ORG_DELETED = 'org:deleted'

export function orgRoom(orgId: string) {
  return `org:${orgId}`
}

// Every connected socket joins its user's room, so the server can reach a person anywhere in the
// app — not just while they're on a board (e.g. to tell them an org they belong to was deleted)
export function userRoom(userId: string) {
  return `user:${userId}`
}
