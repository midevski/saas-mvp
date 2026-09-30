import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import axios from 'axios'
import { api } from '../../lib/api/axiosInstance'
import { useSocket } from '../../context/SocketContext'
import { CARD_ACTIVITY } from '../../lib/socketEvents'
import { relativeTime } from '../../lib/relativeTime'
import { splitMentions } from '../../lib/mentions'
import { MemberAvatar } from '../../components/MemberAvatar'

export interface ActivityEntry {
  id: string
  type: 'comment' | 'system'
  author: { id: string; name: string } | null
  text: string
  mentions: { id: string; name: string }[]
  createdAt: string
}

const MAX_COMMENT_LENGTH = 2000

// Adds entries that aren't there yet (the same entry can arrive as the POST response and as the
// broadcast, in either order), keeping the list in the order things happened
function merge(entries: ActivityEntry[], incoming: ActivityEntry[]) {
  const known = new Set(entries.map((e) => e.id))
  const added = incoming.filter((e) => !known.has(e.id))
  if (added.length === 0) return entries
  return [...entries, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function postError(err: unknown) {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  if (status === 404) return 'This card no longer exists.'
  if (status === 402) return 'This organization needs an active subscription to comment.'
  if (status === 400) return `Comments need 1 to ${MAX_COMMENT_LENGTH} characters.`
  return 'Could not post your comment. Please try again.'
}

// Re-render every 30s so "just now" becomes "1 minute ago" while the view stays open
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

// A card's timeline: what people said (comments) and what they did (system entries — moves,
// checklist ticks, images, edits), newest first. Append-only: comments can't be edited or
// deleted (yet). New entries from anyone arrive live over the socket.
export function ActivityFeed({ orgId, cardId }: { orgId: string; cardId: string }) {
  const { socket } = useSocket()
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postErrorMessage, setPostErrorMessage] = useState<string | null>(null)
  const now = useNow()
  const base = `/orgs/${orgId}/board/cards/${cardId}`

  const load = useCallback(() => {
    api
      .get(`${base}/activity`)
      .then((res) => {
        setLoadError(false)
        // Merge rather than replace, so an entry that arrived live during the fetch isn't dropped
        setEntries((current) => merge(current ?? [], res.data.entries))
      })
      .catch(() => setLoadError(true))
  }, [base])

  useEffect(() => {
    load()
    const onActivity = ({ cardId: forCard, entry }: { cardId: string; entry: ActivityEntry }) => {
      if (forCard === cardId) setEntries((current) => merge(current ?? [], [entry]))
    }
    socket.on(CARD_ACTIVITY, onActivity)
    // Anything posted while the connection was down is picked up on reconnect
    socket.on('connect', load)
    return () => {
      socket.off(CARD_ACTIVITY, onActivity)
      socket.off('connect', load)
    }
  }, [socket, cardId, load])

  async function post(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    setPostErrorMessage(null)
    try {
      const res = await api.post(`${base}/comments`, { text })
      setEntries((current) => merge(current ?? [], [res.data.entry]))
      setDraft('')
    } catch (err) {
      setPostErrorMessage(postError(err)) // the draft is kept, so nothing typed is lost
    } finally {
      setPosting(false)
    }
  }

  // Enter posts, Shift+Enter adds a new line (and Enter while an IME is composing does neither)
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    void post()
  }

  const newestFirst = entries ? [...entries].reverse() : []
  const commentCount = entries?.filter((e) => e.type === 'comment').length ?? 0

  return (
    <section className="stack" style={{ gap: 12 }} aria-labelledby="activity-heading">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 id="activity-heading">Activity</h3>
        {entries && (
          <span className="pill">
            {commentCount} comment{commentCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Newest first, so the composer sits on top and your comment appears right below it */}
      <form className="activity-composer" onSubmit={post}>
        <textarea
          className="textarea"
          aria-label="Write a comment"
          placeholder="Write a comment… mention someone with @Their Name"
          rows={2}
          maxLength={MAX_COMMENT_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="faint mono activity-hint">Enter to post · Shift+Enter for a new line</span>
          <button type="submit" className="btn btn-ink btn-sm" disabled={!draft.trim() || posting}>
            {posting ? 'Posting...' : 'Comment'}
          </button>
        </div>
        {postErrorMessage && (
          <p role="alert" className="alert">
            {postErrorMessage}
          </p>
        )}
      </form>

      {loadError && !entries && (
        <p role="alert" className="alert">
          Could not load this card's activity.{' '}
          <button type="button" className="link-button" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!entries && !loadError && <p className="faint">Loading activity...</p>}

      {entries && (
        <ol className="activity-feed" aria-label="Card activity">
          {newestFirst.map((entry) =>
            entry.type === 'comment' ? (
              <CommentEntry key={entry.id} entry={entry} now={now} />
            ) : (
              <SystemEntry key={entry.id} entry={entry} now={now} />
            ),
          )}
        </ol>
      )}
    </section>
  )
}

function Timestamp({ date, now }: { date: string; now: number }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {Math.abs(now - new Date(date).getTime()) < 60_000 ? 'just now' : relativeTime(date, now)}
    </time>
  )
}

function authorName(entry: ActivityEntry) {
  return entry.author?.name ?? 'System'
}

function CommentEntry({ entry, now }: { entry: ActivityEntry; now: number }) {
  return (
    <li className="activity-comment">
      {entry.author && <MemberAvatar userId={entry.author.id} name={entry.author.name} email={null} size="sm" />}
      <div className="activity-comment-body">
        <div className="activity-meta">
          <strong>{authorName(entry)}</strong>
          <span className="faint">
            <Timestamp date={entry.createdAt} now={now} />
          </span>
        </div>
        <p className="activity-text">
          {splitMentions(entry.text, entry.mentions).map((part, i) =>
            part.kind === 'mention' ? (
              <span key={i} className="mention">
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </p>
      </div>
    </li>
  )
}

// De-emphasized log line: "Sarah moved this card from To Do to Done · 2 minutes ago"
function SystemEntry({ entry, now }: { entry: ActivityEntry; now: number }) {
  return (
    <li className="activity-system">
      <span>
        <strong>{authorName(entry)}</strong> {entry.text}
      </span>
      <span className="faint">
        {' · '}
        <Timestamp date={entry.createdAt} now={now} />
      </span>
    </li>
  )
}
