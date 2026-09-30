import { useCallback, useMemo, useState } from 'react'

// Which columns *this browser* has collapsed on a board. Deliberately local-only: collapsing is a
// personal viewport preference, so it's kept in localStorage — never sent to the server, never
// broadcast, never visible to anyone else (or to you in another browser).
const storageKey = (boardId: string) => `saas-mvp:collapsed-columns:${boardId}`

function read(boardId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(boardId)) ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return [] // storage blocked or corrupted: just start expanded
  }
}

// `boardId` may be null until the board has loaded
export function useCollapsedColumns(boardId: string | null) {
  // Tagged with its board, so a board that loads (or changes) later reads its own saved state
  const [stored, setStored] = useState(() => ({ boardId, ids: boardId ? read(boardId) : [] }))
  const collapsed = useMemo(
    () => (stored.boardId === boardId ? stored.ids : boardId ? read(boardId) : []),
    [stored, boardId],
  )

  // Computed once here, in the event handler — not inside a state updater, which React may run
  // twice (StrictMode does, deliberately): a storage write in there would be applied twice and
  // undo itself
  const toggle = useCallback(
    (columnId: string) => {
      if (!boardId) return
      const ids = collapsed.includes(columnId) ? collapsed.filter((id) => id !== columnId) : [...collapsed, columnId]
      try {
        localStorage.setItem(storageKey(boardId), JSON.stringify(ids))
      } catch {
        // Storage unavailable: still works for this session
      }
      setStored({ boardId, ids })
    },
    [boardId, collapsed],
  )

  return { isCollapsed: (columnId: string) => collapsed.includes(columnId), toggle }
}
