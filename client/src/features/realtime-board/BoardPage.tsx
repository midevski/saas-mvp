import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useSocket } from '../../context/SocketContext'
import { useOrg } from '../../context/OrgContext'
import { useShell } from '../../context/ShellContext'
import { PageHeader } from '../../components/PageHeader'
import { PresenceProvider } from '../../context/PresenceContext'
import { PresenceAvatars } from './PresenceAvatars'
import { CursorOverlay, LiveCursorsProvider } from './CursorLayer'
import { CardDetailView } from './CardDetailView'
import {
  BOARD_JOIN,
  BOARD_LEAVE,
  BOARD_STATE,
  CARD_CREATE,
  CARD_CREATED,
  CARD_DELETE,
  CARD_DELETED,
  CARD_MOVE,
  CARD_MOVED,
  CARD_UPDATE,
  CARD_UPDATED,
  COLUMN_CREATE,
  COLUMN_CREATED,
  COLUMN_DELETE,
  COLUMN_DELETED,
  COLUMN_UPDATE,
  COLUMN_UPDATED,
} from '../../lib/socketEvents'
import { useIsSubscribed } from '../billing/useIsSubscribed'
import {
  boardReducer,
  cardsInColumn,
  sortedColumns,
  type BoardState,
  type CardData,
  type ColumnData,
} from './boardState'
import { AddColumn } from './AddColumn'
import { Column, type DropSide } from './Column'
import { DeleteColumnDialog } from './DeleteColumnDialog'
import { useCollapsedColumns } from './useCollapsedColumns'
import { useColumnOrder } from './useColumnOrder'

const ACK_TIMEOUT_MS = 5000

type Ack =
  | { ok: true; card?: CardData; column?: ColumnData; movedCards?: CardData[] }
  | { ok: false; error: string }

export function BoardPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const subscribed = useIsSubscribed(orgId)

  if (!orgId) return null
  if (subscribed === null) return <p className="eyebrow">Loading...</p>
  if (subscribed) {
    return (
      <PresenceProvider orgId={orgId}>
        <LiveBoard orgId={orgId} />
      </PresenceProvider>
    )
  }

  // Checked before attempting board:join — the server would reject it too, but don't rely on that
  return (
    <>
      <PageHeader eyebrow="Realtime board" title="Collaborative board" />
      <section className="card-ink" style={{ maxWidth: '44rem' }}>
        <div className="blueprint-ink" />
        <div className="glow" style={{ top: '-10rem', right: '-10rem' }} />
        <div className="card-body stack">
          <p className="eyebrow">
            <span className="dot" />
            Pro feature
          </p>
          <h2>The collaborative board requires the Pro plan</h2>
          <p className="muted">Upgrade to give your whole team a live kanban board.</p>
          <div>
            <Link to={`/orgs/${orgId}/billing`} className="btn btn-accent">
              Upgrade to Pro
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

function LiveBoard({ orgId }: { orgId: string }) {
  const { socket, isConnected } = useSocket()
  const { orgs } = useOrg()
  const { headerSlot } = useShell()
  const [state, dispatch] = useReducer(boardReducer, null)
  const [error, setError] = useState<string | null>(null)
  // Live cursor anchors: the page container, the board's scroll viewport, the board's content
  const pageRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // The card whose detail view is open (looked up live in board state on every render)
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  // The column whose delete dialog is open
  const [deletingColumnId, setDeletingColumnId] = useState<string | null>(null)
  // Deep links (e.g. from a notification): ?card=<id> opens that card, &comment=<id> highlights it
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedCardId = searchParams.get('card')
  const linkedCommentId = searchParams.get('comment')
  const [highlightActivityId, setHighlightActivityId] = useState<string | null>(null)
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  // Per-browser only (localStorage): never sent to the server or other users
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedColumns(state?.board.id ?? null)
  const { arrange: arrangeColumns, moveColumn: moveColumnLocally } = useColumnOrder(state?.board.id ?? null)

  const join = useCallback(() => {
    socket.timeout(ACK_TIMEOUT_MS).emit(BOARD_JOIN, { orgId }, (err: Error | null, ack: Ack) => {
      if (err) setError('Could not join the board — retrying when the connection recovers')
      else if (!ack.ok)
        setError(
          ack.error === 'subscription_required' ? 'This org is no longer subscribed' : 'Could not load the board',
        )
      else setError(null)
    })
  }, [socket, orgId])

  // REST snapshot for the first paint, in case the socket is still connecting
  useEffect(() => {
    api
      .get(`/orgs/${orgId}/board`)
      .then((res) => dispatch({ type: 'initial', state: res.data }))
      .catch(() => {})
  }, [orgId])

  useEffect(() => {
    const onState = (s: BoardState) => dispatch({ type: 'snapshot', state: s })
    const onCreated = ({ card }: { card: CardData }) => dispatch({ type: 'created', card })
    const onMoved = (m: { cardId: string; toColumnId: string; toOrder: number }) => dispatch({ type: 'moved', ...m })
    const onUpdated = ({ card }: { card: CardData }) => dispatch({ type: 'updated', card })
    const onDeleted = ({ cardId }: { cardId: string }) => dispatch({ type: 'deleted', cardId })
    const onColumnCreated = ({ column }: { column: ColumnData }) => dispatch({ type: 'columnCreated', column })
    const onColumnUpdated = ({ column }: { column: ColumnData }) =>
      dispatch({ type: 'columnRenamed', columnId: column.id, name: column.name })
    // Also covers what happened to its cards (moved elsewhere or deleted), in one step —
    // safe even mid-interaction, e.g. while a card from that column is open
    const onColumnDeleted = (d: { columnId: string; movedCards?: CardData[] }) =>
      dispatch({ type: 'columnDeleted', columnId: d.columnId, ...(d.movedCards ? { movedCards: d.movedCards } : {}) })

    socket.on(BOARD_STATE, onState)
    socket.on(CARD_CREATED, onCreated)
    socket.on(CARD_MOVED, onMoved)
    socket.on(CARD_UPDATED, onUpdated)
    socket.on(CARD_DELETED, onDeleted)
    socket.on(COLUMN_CREATED, onColumnCreated)
    socket.on(COLUMN_UPDATED, onColumnUpdated)
    socket.on(COLUMN_DELETED, onColumnDeleted)
    // Rooms don't survive a reconnect (dropped network, server restart) — re-join on every
    // connect, which also delivers a fresh board:state covering anything missed meanwhile
    socket.on('connect', join)
    if (socket.connected) join()

    return () => {
      socket.off(BOARD_STATE, onState)
      socket.off(CARD_CREATED, onCreated)
      socket.off(CARD_MOVED, onMoved)
      socket.off(CARD_UPDATED, onUpdated)
      socket.off(CARD_DELETED, onDeleted)
      socket.off(COLUMN_CREATED, onColumnCreated)
      socket.off(COLUMN_UPDATED, onColumnUpdated)
      socket.off(COLUMN_DELETED, onColumnDeleted)
      socket.off('connect', join)
      // The socket outlives this page — tell the server we stopped viewing the board, so we
      // leave its room and drop out of its presence list
      socket.emit(BOARD_LEAVE)
    }
  }, [socket, join])

  // Optimistic updates are applied locally first; if the server rejects or doesn't answer,
  // re-join to pull an authoritative snapshot instead of trying to undo by hand
  const send = useCallback(
    (event: string, payload: object, onOk?: (ack: Ack & { ok: true }) => void) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, ack: Ack) => {
        if (err || !ack.ok) {
          setError('A change could not be saved — board reloaded')
          join()
          return
        }
        onOk?.(ack)
      })
    },
    [socket, join],
  )

  // Once the board has loaded, follow the link (state adjusted during render, React's pattern for
  // reacting to a changed input) ...
  const linkKey = linkedCardId && state ? `${linkedCardId}:${linkedCommentId ?? ''}` : null
  const [followedLink, setFollowedLink] = useState<string | null>(null)
  if (linkKey !== followedLink) {
    setFollowedLink(linkKey)
    if (linkKey && state) {
      if (state.cards.some((c) => c.id === linkedCardId)) {
        setOpenCardId(linkedCardId)
        setHighlightActivityId(linkedCommentId)
        setLinkNotice(null)
      } else {
        setLinkNotice('That card no longer exists — it may have been deleted.')
      }
    }
  }
  // ... then drop it from the URL, so a reload or closing the card doesn't reopen it
  useEffect(() => {
    if (linkKey) setSearchParams({}, { replace: true })
  }, [linkKey, setSearchParams])

  if (!state) return <p className="eyebrow">Loading board...</p>

  // If someone else deletes the open card, its detail view simply goes away
  const openCard = openCardId ? state.cards.find((c) => c.id === openCardId) : undefined

  function createCard(columnId: string, title: string) {
    // Not optimistic: waits for the server-assigned id
    send(CARD_CREATE, { boardId: state!.board.id, columnId, title }, (ack) => {
      if (ack.card) dispatch({ type: 'created', card: ack.card })
    })
  }

  function moveCard(cardId: string, toColumnId: string, toOrder: number) {
    dispatch({ type: 'moved', cardId, toColumnId, toOrder })
    send(CARD_MOVE, { cardId, toColumnId, toOrder })
  }

  function updateCard(card: CardData, title: string, description: string | null) {
    dispatch({ type: 'updated', card: { ...card, title, description } })
    send(CARD_UPDATE, { cardId: card.id, title, description })
  }

  function deleteCard(cardId: string) {
    dispatch({ type: 'deleted', cardId })
    send(CARD_DELETE, { cardId })
  }

  // ---- Columns: same pattern as cards (optimistic, then confirmed; resync on failure) ----
  // The board's shared columns, in this browser's own order
  const columns = arrangeColumns(sortedColumns(state.columns))

  function createColumn(name: string) {
    // Not optimistic: waits for the server-assigned id
    send(COLUMN_CREATE, { boardId: state!.board.id, name }, (ack) => {
      if (ack.column) dispatch({ type: 'columnCreated', column: ack.column })
    })
  }

  function renameColumn(columnId: string, name: string) {
    dispatch({ type: 'columnRenamed', columnId, name })
    send(COLUMN_UPDATE, { columnId, name })
  }

  // Reordering is this viewer's own layout (like collapsing): saved in this browser only, never
  // sent — so it can't move columns around under anyone else
  function moveColumn(columnId: string, toIndex: number) {
    moveColumnLocally(columns, columnId, toIndex)
  }

  // Drop position -> index among the other columns
  function dropColumn(draggedId: string, targetId: string, side: DropSide) {
    const others = columns.filter((c) => c.id !== draggedId)
    const targetIndex = others.findIndex((c) => c.id === targetId)
    if (targetIndex === -1) return
    moveColumn(draggedId, side === 'before' ? targetIndex : targetIndex + 1)
  }

  function deleteColumn(columnId: string, moveCardsTo?: string) {
    setDeletingColumnId(null)
    // Optimistic: the cards land at the bottom of the destination, in their current order
    const movedCards = moveCardsTo
      ? cardsInColumn(state!.cards, columnId).map((card, i) => ({
          ...card,
          columnId: moveCardsTo,
          order: cardsInColumn(state!.cards, moveCardsTo).length + i,
        }))
      : undefined
    dispatch({ type: 'columnDeleted', columnId, ...(movedCards ? { movedCards } : {}) })
    send(COLUMN_DELETE, { columnId, ...(moveCardsTo ? { moveCardsTo } : {}) }, (ack) => {
      // The server's version of where the cards ended up is authoritative
      if (ack.movedCards) dispatch({ type: 'columnDeleted', columnId, movedCards: ack.movedCards })
    })
  }

  const deletingColumn = columns.find((c) => c.id === deletingColumnId)

  return (
    <LiveCursorsProvider orgId={orgId} pageRef={pageRef} boardRef={boardRef} trackRef={trackRef}>
      <div className="board-page" ref={pageRef}>
        <PageHeader
          eyebrow="Realtime board"
          title={orgs.find((o) => o.id === orgId)?.name ?? state.board.name}
          lede="Drag cards between columns. Changes appear instantly for everyone on this board."
          actions={
            <span className={isConnected ? 'pill pill-success' : 'pill'}>
              <span className={isConnected ? 'dot dot-live' : 'dot dot-off'} />
              {isConnected ? 'Live' : 'Reconnecting...'}
            </span>
          }
        />
        {/* Who's viewing this board lives in the navbar; a portal keeps it inside this board's
            presence data */}
        {headerSlot && createPortal(<PresenceAvatars />, headerSlot)}
        {error && (
          <p role="alert" className="alert" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}
        {linkNotice && (
          <div className="notice notice-dismissible" role="status">
            <span>{linkNotice}</span>
            <button type="button" className="modal-close" aria-label="Dismiss" onClick={() => setLinkNotice(null)}>
              ×
            </button>
          </div>
        )}
        <div className="board" ref={boardRef}>
          <div className="board-track" ref={trackRef}>
            {columns.map((column, index) => (
              <Column
                key={column.id}
                column={column}
                cards={cardsInColumn(state.cards, column.id)}
                isFirst={index === 0}
                isLast={index === columns.length - 1}
                collapsed={isCollapsed(column.id)}
                onToggleCollapse={() => toggleCollapsed(column.id)}
                onRename={(name) => renameColumn(column.id, name)}
                onRequestDelete={() => setDeletingColumnId(column.id)}
                onColumnDrop={(draggedId, side) => dropColumn(draggedId, column.id, side)}
                onShift={(delta) => moveColumn(column.id, index + delta)}
                onCreate={createCard}
                onMove={moveCard}
                onOpen={setOpenCardId}
                onDelete={deleteCard}
              />
            ))}
            <AddColumn onAdd={createColumn} />
          </div>
        </div>
        {deletingColumn && (
          <DeleteColumnDialog
            column={deletingColumn}
            cardCount={cardsInColumn(state.cards, deletingColumn.id).length}
            otherColumns={columns.filter((c) => c.id !== deletingColumn.id)}
            onConfirm={(moveCardsTo) => deleteColumn(deletingColumn.id, moveCardsTo)}
            onCancel={() => setDeletingColumnId(null)}
          />
        )}
        <CursorOverlay />
      </div>
      {openCard && (
        <CardDetailView
          // Remount per card so the form starts from that card's values
          key={openCard.id}
          orgId={orgId}
          card={openCard}
          onClose={() => {
            setOpenCardId(null)
            setHighlightActivityId(null)
          }}
          highlightActivityId={highlightActivityId}
          onSave={updateCard}
          onCardChanged={(card) => dispatch({ type: 'updated', card })}
          onResync={join}
        />
      )}
    </LiveCursorsProvider>
  )
}
