export interface AttachmentData {
  id: string
  url: string
  filename: string
  uploadedBy: string
  uploadedAt: string
}

export interface ChecklistItemData {
  id: string
  text: string
  completed: boolean
  completedBy: string | null
  completedAt: string | null
}

export interface ChecklistData {
  id: string
  title: string
  items: ChecklistItemData[]
}

export interface CardData {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string | null
  order: number
  createdBy: string
  attachments: AttachmentData[]
  checklists: ChecklistData[]
  createdAt: string
  updatedAt: string
}

export interface ColumnData {
  id: string
  name: string
  order: number
}

export interface BoardState {
  board: { id: string; name: string }
  columns: ColumnData[]
  cards: CardData[]
}

export type BoardAction =
  // `initial` is the REST snapshot: only applied if the socket hasn't delivered one yet
  | { type: 'initial'; state: BoardState }
  | { type: 'snapshot'; state: BoardState }
  | { type: 'created'; card: CardData }
  | { type: 'moved'; cardId: string; toColumnId: string; toOrder: number }
  | { type: 'updated'; card: CardData }
  | { type: 'deleted'; cardId: string }
  | { type: 'columnCreated'; column: ColumnData }
  | { type: 'columnRenamed'; columnId: string; name: string }
  // One step for the column and what happened to its cards (moved elsewhere, or deleted)
  | { type: 'columnDeleted'; columnId: string; movedCards?: CardData[] }

// The board's shared *default* order (creation order). Each viewer may rearrange columns for
// themselves on top of this — see useColumnOrder.
export function sortedColumns(columns: ColumnData[]) {
  return [...columns].sort((a, b) => a.order - b.order)
}

// Across all of a card's checklists — for the progress shown in the detail view and on the card face
export function checklistProgress(checklists: ChecklistData[]) {
  const items = checklists.flatMap((c) => c.items)
  return { done: items.filter((i) => i.completed).length, total: items.length }
}

export function cardsInColumn(cards: CardData[], columnId: string) {
  return cards.filter((c) => c.columnId === columnId).sort((a, b) => a.order - b.order)
}

function resequence(cards: CardData[], ids: string[], columnId: string): CardData[] {
  const position = new Map(ids.map((id, index) => [id, index]))
  return cards.map((c) => (position.has(c.id) ? { ...c, columnId, order: position.get(c.id)! } : c))
}

// Mirrors board.service moveCard on the server: splice into the target column at the
// (clamped) index, then re-sequence the affected column(s) to 0..n-1
function applyMove(cards: CardData[], cardId: string, toColumnId: string, toOrder: number) {
  const card = cards.find((c) => c.id === cardId)
  if (!card) return cards

  const targetIds = cardsInColumn(cards, toColumnId)
    .filter((c) => c.id !== cardId)
    .map((c) => c.id)
  const index = Math.max(0, Math.min(toOrder, targetIds.length))
  targetIds.splice(index, 0, cardId)

  let next = resequence(cards, targetIds, toColumnId)
  if (card.columnId !== toColumnId) {
    const remainingIds = cardsInColumn(next, card.columnId).map((c) => c.id)
    next = resequence(next, remainingIds, card.columnId)
  }
  return next
}

export function boardReducer(state: BoardState | null, action: BoardAction): BoardState | null {
  switch (action.type) {
    case 'initial':
      return state ?? action.state
    case 'snapshot':
      return action.state
  }

  if (!state) return state

  switch (action.type) {
    case 'created':
      // Idempotent: a create can arrive both as an ack and (in another tab) as a broadcast
      if (state.cards.some((c) => c.id === action.card.id)) return state
      return { ...state, cards: [...state.cards, action.card] }
    case 'moved':
      return { ...state, cards: applyMove(state.cards, action.cardId, action.toColumnId, action.toOrder) }
    case 'updated':
      // Only take the edited fields — position is owned by move events
      return {
        ...state,
        cards: state.cards.map((c) =>
          c.id === action.card.id
            ? {
                ...c,
                title: action.card.title,
                description: action.card.description,
                attachments: action.card.attachments ?? c.attachments,
                checklists: action.card.checklists ?? c.checklists,
                updatedAt: action.card.updatedAt,
              }
            : c,
        ),
      }
    case 'deleted':
      return { ...state, cards: state.cards.filter((c) => c.id !== action.cardId) }

    case 'columnCreated':
      if (state.columns.some((c) => c.id === action.column.id)) return state
      return { ...state, columns: [...state.columns, action.column] }
    case 'columnRenamed':
      return {
        ...state,
        columns: state.columns.map((c) => (c.id === action.columnId ? { ...c, name: action.name } : c)),
      }
    case 'columnDeleted': {
      // Safe even if the column is already gone (e.g. our own optimistic delete, then the ack)
      const moved = new Map((action.movedCards ?? []).map((c) => [c.id, c]))
      const remaining = sortedColumns(state.columns.filter((c) => c.id !== action.columnId))
      return {
        ...state,
        columns: remaining.map((c, order) => ({ ...c, order })),
        cards: state.cards
          .filter((c) => c.columnId !== action.columnId || moved.has(c.id))
          .map((c) => {
            const next = moved.get(c.id)
            return next ? { ...c, columnId: next.columnId, order: next.order } : c
          }),
      }
    }
  }
}
