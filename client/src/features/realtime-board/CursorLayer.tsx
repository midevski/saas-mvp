import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from 'react'
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

// Two coordinate spaces, because the board's columns scroll but the rest of the page doesn't:
//   'board' — pixels relative to the board's content track. Its layout is identical for every
//             viewer, so these are exact regardless of window size or board scroll.
//   'page'  — pixels relative to the board page container (header, gaps, margins around the
//             board). Exact for elements at the same offset for everyone (e.g. the title);
//             text that wraps differently in a narrower window can shift slightly.
type CursorArea = 'board' | 'page'

interface CursorPosition {
  x: number
  y: number
  area: CursorArea
}

interface RemoteCursor extends CursorPosition {
  at: number
}

const CursorsContext = createContext<Record<string, RemoteCursor>>({})

interface LiveCursorsProviderProps {
  orgId: string
  pageRef: RefObject<HTMLDivElement | null> // the board page container
  boardRef: RefObject<HTMLDivElement | null> // the board's horizontal scroll viewport
  trackRef: RefObject<HTMLDivElement | null> // the board's content track
  children: ReactNode
}

// Tracks my pointer anywhere on the board page and receives everyone else's.
// Render <CursorLayer area="page"> and <CursorLayer area="board"> inside it.
export function LiveCursorsProvider({ orgId, pageRef, boardRef, trackRef, children }: LiveCursorsProviderProps) {
  const { socket } = useSocket()
  const { user } = useAuth()
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const myId = user?.id

  // Outgoing: my pointer position, throttled
  useEffect(() => {
    // volatile: while disconnected, cursor frames are dropped rather than queued and replayed
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
    const onUpdate = (update: { userId: string; x: number | null; y: number | null; area: CursorArea | null }) => {
      const { userId, x, y, area } = update
      if (userId === myId) return // my own other tab
      setCursors((prev) => {
        if (x === null || y === null || area === null) {
          const next = { ...prev }
          delete next[userId]
          return next
        }
        return { ...prev, [userId]: { x, y, area, at: Date.now() } }
      })
    }
    socket.on(CURSOR_UPDATE, onUpdate)
    return () => {
      socket.off(CURSOR_UPDATE, onUpdate)
    }
  }, [socket, myId])

  return <CursorsContext.Provider value={cursors}>{children}</CursorsContext.Provider>
}

// Draws the cursors currently in one area. pointer-events: none — never blocks the page.
// The browser moves each layer with its own content, so scrolling needs no recalculation.
export function CursorLayer({ area }: { area: CursorArea }) {
  const cursors = useContext(CursorsContext)
  const { onlineMembers } = usePresence()
  const [now, setNow] = useState(() => Date.now())

  // Re-evaluate idle fading once a second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  // Only people Phase 8 presence says are on this board right now — a closed tab or dropped
  // connection removes their cursor as soon as presence does
  const onlineById = new Map(onlineMembers.map((m) => [m.userId, m]))

  return (
    <div className={`cursor-layer cursor-layer-${area}`} aria-hidden="true">
      {Object.entries(cursors).map(([userId, cursor]) => {
        const member = onlineById.get(userId)
        if (!member || cursor.area !== area) return null
        const color = colorForUser(userId)
        const label = member.name?.split(/\s+/)[0] || member.email?.split('@')[0] || 'Someone'
        const idle = now - cursor.at > IDLE_HIDE_MS
        return (
          <div
            key={userId}
            className={idle ? 'remote-cursor is-idle' : 'remote-cursor'}
            data-cursor-user={member.name ?? member.email ?? userId}
            data-cursor-area={area}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
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
