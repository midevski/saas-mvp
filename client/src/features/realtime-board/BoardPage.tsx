import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useSocket } from '../../context/SocketContext'
import { useOrg } from '../../context/OrgContext'
import { PageHeader } from '../../components/PageHeader'
import { InviteButton } from '../dashboard/InviteButton'
import { PresenceProvider } from '../../context/PresenceContext'
import { PresenceAvatars } from './PresenceAvatars'
import { CursorLayer, LiveCursorsProvider } from './CursorLayer'
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
} from '../../lib/socketEvents'
import { useIsSubscribed } from '../billing/useIsSubscribed'
import { boardReducer, cardsInColumn, type BoardState, type CardData } from './boardState'
import { Column } from './Column'

const ACK_TIMEOUT_MS = 5000

type Ack = { ok: true; card?: CardData } | { ok: false; error: string }

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
      <PageHeader
        eyebrow="Realtime board"
        title="Collaborative board"
        actions={<InviteButton orgId={orgId} />}
      />
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
  const [state, dispatch] = useReducer(boardReducer, null)
  const [error, setError] = useState<string | null>(null)
  // Live cursor anchors: the page container, the board's scroll viewport, the board's content
  const pageRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

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

    socket.on(BOARD_STATE, onState)
    socket.on(CARD_CREATED, onCreated)
    socket.on(CARD_MOVED, onMoved)
    socket.on(CARD_UPDATED, onUpdated)
    socket.on(CARD_DELETED, onDeleted)
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

  if (!state) return <p className="eyebrow">Loading board...</p>

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

  return (
    <LiveCursorsProvider orgId={orgId} pageRef={pageRef} boardRef={boardRef} trackRef={trackRef}>
      <div className="board-page" ref={pageRef}>
        <PageHeader
          eyebrow="Realtime board"
          title={orgs.find((o) => o.id === orgId)?.name ?? state.board.name}
          lede="Drag cards between columns. Changes appear instantly for everyone on this board."
          actions={
            <>
              <PresenceAvatars />
              <span className={isConnected ? 'pill pill-success' : 'pill'}>
                <span className={isConnected ? 'dot dot-live' : 'dot dot-off'} />
                {isConnected ? 'Live' : 'Reconnecting...'}
              </span>
              <InviteButton orgId={orgId} />
            </>
          }
        />
        {error && (
          <p role="alert" className="alert" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}
        <div className="board" ref={boardRef}>
          <div className="board-track" ref={trackRef}>
            {state.columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                cards={cardsInColumn(state.cards, column.id)}
                onCreate={createCard}
                onMove={moveCard}
                onUpdate={updateCard}
                onDelete={deleteCard}
              />
            ))}
            <CursorLayer area="board" />
          </div>
        </div>
        <CursorLayer area="page" />
      </div>
    </LiveCursorsProvider>
  )
}
