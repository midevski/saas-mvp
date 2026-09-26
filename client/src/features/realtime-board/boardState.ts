export interface CardData {
  id: string
  boardId: string
  columnId: string
  title: string
  description: string | null
  order: number
  createdBy: string
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
            ? { ...c, title: action.card.title, description: action.card.description, updatedAt: action.card.updatedAt }
            : c,
        ),
      }
    case 'deleted':
      return { ...state, cards: state.cards.filter((c) => c.id !== action.cardId) }
  }
}
