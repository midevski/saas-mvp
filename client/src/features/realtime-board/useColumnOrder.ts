import { useCallback, useMemo, useState } from 'react'
import type { ColumnData } from './boardState'

// This browser's own left-to-right column order on a board. Like collapsing, it's a personal
// layout choice: kept in localStorage, never sent to the server, never seen by anyone else.
// Columns this browser hasn't placed yet (e.g. just added by a teammate) go at the end, in the
// board's default order; deleted columns simply drop out.
const storageKey = (boardId: string) => `saas-mvp:column-order:${boardId}`

function read(boardId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(boardId)) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return [] // storage blocked or corrupted: use the board's default order
  }
}

// `boardId` may be null until the board has loaded
export function useColumnOrder(boardId: string | null) {
  const [stored, setStored] = useState(() => ({ boardId, ids: boardId ? read(boardId) : [] }))
  const saved = useMemo(
    () => (stored.boardId === boardId ? stored.ids : boardId ? read(boardId) : []),
    [stored, boardId],
  )

  // `columns` in the board's default order -> this browser's order
  const arrange = useCallback(
    (columns: ColumnData[]) => {
      const rank = new Map(saved.map((id, index) => [id, index]))
      const placed = columns.filter((c) => rank.has(c.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
      const unplaced = columns.filter((c) => !rank.has(c.id))
      return [...placed, ...unplaced]
    },
    [saved],
  )

  // Move a column to `toIndex` within the currently displayed order. Computed here in the
  // event handler (not inside a state updater, which React may run twice) and saved once.
  const moveColumn = useCallback(
    (displayed: ColumnData[], columnId: string, toIndex: number) => {
      if (!boardId) return
      const ids = displayed.map((c) => c.id).filter((id) => id !== columnId)
      ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, columnId)
      try {
        localStorage.setItem(storageKey(boardId), JSON.stringify(ids))
      } catch {
        // Storage unavailable: still works for this session
      }
      setStored({ boardId, ids })
    },
    [boardId],
  )

  return { arrange, moveColumn }
}
