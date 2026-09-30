import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePresence } from '../../context/PresenceContext'
import { useSocket } from '../../context/SocketContext'
import { createCursorThrottle } from '../../lib/cursorThrottle'
import { CURSOR_MOVE, CURSOR_UPDATE } from '../../lib/socketEvents'
import { colorForUser } from '../../lib/userColor'

// ~25 updates/sec: smooth enough with interpolation, without flooding the socket
const SEND_INTERVAL_MS = 40
// Someone whose mouse has been still this long fades out rather than sitting frozen on screen
const IDLE_HIDE_MS = 5_000

// Coordinate spaces, because parts of the page scroll — and are laid out — differently per viewer:
//   'column'      — relative to one column's card list content (each list scrolls on its own,
//                   so a card is at the same spot for everyone however far they've scrolled it).
//   'columnFrame' — relative to one column's whole box (its header, add-card form). Anchored to
//                   the column itself because each viewer orders and collapses columns their
//                   own way: "over the To Do header" must land on To Do wherever it sits.
//   'board'       — relative to the board's content track (the gaps between columns).
//   'page'        — relative to the board page container (header, margins around the board).
//                   Exact for elements at the same offset for everyone (e.g. the title).
type CursorArea = 'board' | 'page' | 'column' | 'columnFrame'

interface CursorPosition {
  x: number
  y: number
  area: CursorArea
  columnId?: string // only for 'column' and 'columnFrame'
}

interface RemoteCursor extends CursorPosition {
  at: number
}

interface CursorsContextValue {
  cursors: Record<string, RemoteCursor>
  pageRef: RefObject<HTMLDivElement | null>
  boardRef: RefObject<HTMLDivElement | null>
  trackRef: RefObject<HTMLDivElement | null>
}

const CursorsContext = createContext<CursorsContextValue | null>(null)

interface LiveCursorsProviderProps {
  orgId: string
  pageRef: RefObject<HTMLDivElement | null> // the board page container
  boardRef: RefObject<HTMLDivElement | null> // the board's horizontal scroll viewport
  trackRef: RefObject<HTMLDivElement | null> // the board's content track
  children: ReactNode
}

// Tracks my pointer anywhere on the board page and receives everyone else's.
// Render one <CursorOverlay /> inside the page container.
export function LiveCursorsProvider({ orgId, pageRef, boardRef, trackRef, children }: LiveCursorsProviderProps) {
  const { socket } = useSocket()
  const { user } = useAuth()
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const myId = user?.id

  // Outgoing: my pointer position, throttled
  useEffect(() => {
    // volatile: while disconnected, cursor frames are dropped rather than queued and replayed.
    // (columnId is only present for 'column' positions.)
    const throttle = createCursorThrottle<CursorPosition>(SEND_INTERVAL_MS, (position) =>
      socket.volatile.emit(CURSOR_MOVE, { orgId, ...position }),
    )

    const onMove = (e: MouseEvent) => {
      const page = pageRef.current
      const board = boardRef.current
      const track = trackRef.current
      if (!page || !board || !track) return

      const b = board.getBoundingClientRect()
      const t = track.getBoundingClientRect()
      const overBoard =
        e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= Math.min(b.bottom, t.bottom)

      if (overBoard) {
        // Over a column's card list? Position relative to its (independently scrolled) content
        for (const list of track.querySelectorAll<HTMLElement>('[data-cursor-column]')) {
          const viewport = list.parentElement!.getBoundingClientRect()
          const inside =
            e.clientX >= viewport.left &&
            e.clientX <= viewport.right &&
            e.clientY >= viewport.top &&
            e.clientY <= viewport.bottom
          if (!inside) continue
          const content = list.getBoundingClientRect() // already reflects the list's scroll
          throttle.push({
            x: Math.round(e.clientX - content.left),
            y: Math.round(e.clientY - content.top),
            area: 'column',
            columnId: list.dataset.cursorColumn!,
          })
          return
        }
        // Over a column's box (header, add-card form, or a collapsed strip)? Anchor to that column
        for (const frame of track.querySelectorAll<HTMLElement>('[data-cursor-column-frame]')) {
          const f = frame.getBoundingClientRect()
          if (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom) continue
          throttle.push({
            x: Math.round(e.clientX - f.left),
            y: Math.round(e.clientY - f.top),
            area: 'columnFrame',
            columnId: frame.dataset.cursorColumnFrame!,
          })
          return
        }
        throttle.push({ x: Math.round(e.clientX - t.left), y: Math.round(e.clientY - t.top), area: 'board' })
      } else {
        const p = page.getBoundingClientRect()
        throttle.push({ x: Math.round(e.clientX - p.left), y: Math.round(e.clientY - p.top), area: 'page' })
      }
    }
    const hide = () => {
      throttle.cancel()
      socket.volatile.emit(CURSOR_MOVE, { orgId, x: null, y: null })
    }

    // Capture phase: board drop targets stop dragover from bubbling. dragover matters because
    // browsers don't fire mousemove during HTML5 drag-and-drop.
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('dragover', onMove, true)
    // Pointer left the browser window, or the window lost focus
    document.documentElement.addEventListener('mouseleave', hide)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('dragover', onMove, true)
      document.documentElement.removeEventListener('mouseleave', hide)
      window.removeEventListener('blur', hide)
      throttle.cancel()
    }
  }, [socket, orgId, pageRef, boardRef, trackRef])

  // Incoming: everyone else's positions
  useEffect(() => {
    const onUpdate = (update: {
      userId: string
      x: number | null
      y: number | null
      area: CursorArea | null
      columnId?: string
    }) => {
      const { userId, x, y, area, columnId } = update
      if (userId === myId) return // my own other tab
      setCursors((prev) => {
        if (x === null || y === null || area === null) {
          const next = { ...prev }
          delete next[userId]
          return next
        }
        return { ...prev, [userId]: { x, y, area, columnId, at: Date.now() } }
      })
    }
    socket.on(CURSOR_UPDATE, onUpdate)
    return () => {
      socket.off(CURSOR_UPDATE, onUpdate)
    }
  }, [socket, myId])

  return (
    <CursorsContext.Provider value={{ cursors, pageRef, boardRef, trackRef }}>{children}</CursorsContext.Provider>
  )
}

interface Placement {
  x: number
  y: number
  visible: boolean
}

function within(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

// Converts a received position (in whichever anchor space it was sent) into a position inside
// the page container, and whether that spot is actually visible on *this* screen — e.g. a card
// in a part of a list this viewer has scrolled out of view.
function placeCursor(
  cursor: RemoteCursor,
  page: HTMLElement,
  board: HTMLElement | null,
  track: HTMLElement | null,
): Placement {
  const p = page.getBoundingClientRect()
  if (cursor.area === 'page') return { x: cursor.x, y: cursor.y, visible: true }

  if (!board || !track) return { x: 0, y: 0, visible: false }
  if (cursor.area === 'board') {
    const t = track.getBoundingClientRect()
    const x = t.left + cursor.x
    const y = t.top + cursor.y
    return { x: x - p.left, y: y - p.top, visible: within(board.getBoundingClientRect(), x, y) }
  }

  const list =
    cursor.area === 'column' ? track.querySelector<HTMLElement>(`[data-cursor-column="${cursor.columnId}"]`) : null
  if (list) {
    const l = list.getBoundingClientRect() // reflects this viewer's scroll of that list
    const x = l.left + cursor.x
    const y = l.top + cursor.y
    return { x: x - p.left, y: y - p.top, visible: within(list.parentElement!.getBoundingClientRect(), x, y) }
  }

  // Anchored to the column's box — also the fallback when this viewer has that column collapsed
  // (no list to anchor to): the cursor then sits on the slim strip, clamped inside it
  const frame = track.querySelector<HTMLElement>(`[data-cursor-column-frame="${cursor.columnId}"]`)
  if (!frame) return { x: 0, y: 0, visible: false } // column deleted meanwhile
  const f = frame.getBoundingClientRect()
  const x = f.left + Math.min(cursor.x, f.width - 6)
  const y = f.top + Math.min(cursor.y, f.height - 6)
  return { x: x - p.left, y: y - p.top, visible: within(board.getBoundingClientRect(), x, y) }
}

// One overlay for the whole board page, with exactly one element per remote user that's never
// recreated. Moving between areas (page ↔ board ↔ a card list) just changes where that element
// is placed, so the CSS transition keeps the motion continuous — no jump at the boundaries.
// Positions are applied imperatively: after each update, and on this viewer's own scrolling or
// resizing (instantly, so a cursor doesn't float behind content being scrolled).
export function CursorOverlay() {
  const ctx = useContext(CursorsContext)
  if (!ctx) throw new Error('CursorOverlay must be used within LiveCursorsProvider')
  const { cursors, pageRef, boardRef, trackRef } = ctx
  const { onlineMembers } = usePresence()
  const [now, setNow] = useState(() => Date.now())
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const latest = useRef(cursors)

  // Re-evaluate idle fading once a second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const placeAll = useCallback(
    (instant: boolean) => {
      const page = pageRef.current
      if (!page) return
      for (const [userId, el] of nodes.current) {
        const cursor = latest.current[userId]
        if (!cursor) continue
        const { x, y, visible } = placeCursor(cursor, page, boardRef.current, trackRef.current)
        // A cursor's first placement is instant too, so it doesn't glide in from the corner
        const firstPlacement = el.dataset.placed !== 'true'
        el.dataset.placed = 'true'
        el.style.transition = instant || firstPlacement ? 'none' : ''
        el.style.transform = `translate(${x}px, ${y}px)`
        el.classList.toggle('is-offscreen', !visible)
      }
    },
    [pageRef, boardRef, trackRef],
  )

  // New positions arrived (or cursors appeared/disappeared): animate to them
  useLayoutEffect(() => {
    latest.current = cursors
    placeAll(false)
  })

  // My own scrolling (page, board or any list) and resizing move the anchors: follow instantly
  useEffect(() => {
    let frame = 0
    const onScrollOrResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => placeAll(true))
    }
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true })
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScrollOrResize, { capture: true })
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [placeAll])

  // Only people Phase 8 presence says are on this board right now — a closed tab or dropped
  // connection removes their cursor as soon as presence does
  const onlineById = new Map(onlineMembers.map((m) => [m.userId, m]))

  return (
    <div className="cursor-overlay" aria-hidden="true">
      {Object.entries(cursors).map(([userId, cursor]) => {
        const member = onlineById.get(userId)
        if (!member) return null
        const color = colorForUser(userId)
        const label = member.name?.split(/\s+/)[0] || member.email?.split('@')[0] || 'Someone'
        const idle = now - cursor.at > IDLE_HIDE_MS
        return (
          <div
            key={userId}
            ref={(el) => {
              if (el) nodes.current.set(userId, el)
              else nodes.current.delete(userId)
            }}
            className={idle ? 'remote-cursor is-idle' : 'remote-cursor'}
            data-cursor-user={member.name ?? member.email ?? userId}
            data-cursor-area={cursor.area}
          >
            <svg width="18" height="22" viewBox="0 0 18 22">
              <path
                d="M1.5 1.5 L1.5 17.5 L6 13.2 L9 20.3 L11.9 19.1 L8.9 12.1 L15 12 Z"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="remote-cursor-label" style={{ background: color }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
