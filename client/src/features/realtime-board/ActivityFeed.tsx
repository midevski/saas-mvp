import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import axios from 'axios'
import { api } from '../../lib/api/axiosInstance'
import { useAuth } from '../../context/AuthContext'
import { useOrg } from '../../context/OrgContext'
import { usePresence } from '../../context/PresenceContext'
import { useSocket } from '../../context/SocketContext'
import { CARD_ACTIVITY, CARD_ACTIVITY_DELETED } from '../../lib/socketEvents'
import { relativeTime } from '../../lib/relativeTime'
import { findMentions, splitMentions } from '../../lib/mentions'
import { MemberAvatar } from '../../components/MemberAvatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MentionInput, type MentionCandidate } from './MentionInput'

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
// broadcast, in either order), keeping the list in the order things happened. Entries known to
// be deleted never come back (e.g. a fetch that started before the delete).
function merge(entries: ActivityEntry[], incoming: ActivityEntry[], deleted: Set<string>) {
  const known = new Set(entries.map((e) => e.id))
  const added = incoming.filter((e) => !known.has(e.id) && !deleted.has(e.id))
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

function deleteError(err: unknown) {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  if (status === 403) return "You can't delete this comment."
  if (status === 404) return 'That comment was already deleted.'
  return 'Could not delete the comment. Please try again.'
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
// checklist ticks, images, edits), newest first. New and deleted entries from anyone show up
// live over the socket. Comments can be deleted (by their author, or an owner/admin), not edited.
export function ActivityFeed({ orgId, cardId }: { orgId: string; cardId: string }) {
  const { socket } = useSocket()
  const { user } = useAuth()
  const { orgs } = useOrg()
  const { onlineMembers, offlineMembers } = usePresence()
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState<MentionCandidate[]>([])
  const [posting, setPosting] = useState(false)
  const [postErrorMessage, setPostErrorMessage] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ActivityEntry | null>(null)
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null)
  const deletedIds = useRef(new Set<string>())
  const now = useNow()
  const base = `/orgs/${orgId}/board/cards/${cardId}`

  const role = orgs.find((o) => o.id === orgId)?.role
  const canModerate = role === 'owner' || role === 'admin'
  const canDelete = (entry: ActivityEntry) =>
    entry.type === 'comment' && (canModerate || (!!user && entry.author?.id === user.id))

  // Anyone in the org except yourself, from the member list the board already loaded
  const candidates = useMemo(
    () =>
      [...onlineMembers, ...offlineMembers]
        .filter((m) => m.userId !== user?.id)
        .map((m) => ({ id: m.userId, name: m.name ?? m.email ?? 'Unknown member' })),
    [onlineMembers, offlineMembers, user?.id],
  )

  const addEntries = useCallback((incoming: ActivityEntry[]) => {
    setEntries((current) => merge(current ?? [], incoming, deletedIds.current))
  }, [])

  const removeEntry = useCallback((activityId: string) => {
    deletedIds.current.add(activityId)
    setEntries((current) => current && current.filter((e) => e.id !== activityId))
  }, [])

  const load = useCallback(() => {
    api
      .get(`${base}/activity`)
      .then((res) => {
        setLoadError(false)
        // Merge rather than replace, so an entry that arrived live during the fetch isn't dropped
        addEntries(res.data.entries)
      })
      .catch(() => setLoadError(true))
  }, [base, addEntries])

  useEffect(() => {
    load()
    const onActivity = ({ cardId: forCard, entry }: { cardId: string; entry: ActivityEntry }) => {
      if (forCard === cardId) addEntries([entry])
    }
    const onDeleted = ({ cardId: forCard, activityId }: { cardId: string; activityId: string }) => {
      if (forCard === cardId) removeEntry(activityId)
    }
    socket.on(CARD_ACTIVITY, onActivity)
    socket.on(CARD_ACTIVITY_DELETED, onDeleted)
    // Anything posted while the connection was down is picked up on reconnect
    socket.on('connect', load)
    return () => {
      socket.off(CARD_ACTIVITY, onActivity)
      socket.off(CARD_ACTIVITY_DELETED, onDeleted)
      socket.off('connect', load)
    }
  }, [socket, cardId, load, addEntries, removeEntry])

  async function post(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || posting) return
    // Only people picked from the dropdown whose "@Name" is still in the text — a pick that was
    // later deleted from the text isn't a mention anymore. Each person once.
    const mentionedUserIds = [...new Set(findMentions(text, picked).map((m) => m.id))]
    setPosting(true)
    setPostErrorMessage(null)
    try {
      const res = await api.post(`${base}/comments`, { text, mentionedUserIds })
      addEntries([res.data.entry])
      setDraft('')
      setPicked([])
    } catch (err) {
      setPostErrorMessage(postError(err)) // the draft is kept, so nothing typed is lost
    } finally {
      setPosting(false)
    }
  }

  async function confirmDelete(entry: ActivityEntry) {
    setDeleteErrorMessage(null)
    try {
      await api.delete(`${base}/comments/${entry.id}`)
      removeEntry(entry.id)
    } catch (err) {
      setDeleteErrorMessage(deleteError(err))
      if (axios.isAxiosError(err) && err.response?.status === 404) removeEntry(entry.id)
    } finally {
      setPendingDelete(null)
    }
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
        <MentionInput
          label="Write a comment"
          placeholder="Write a comment… type @ to mention someone"
          maxLength={MAX_COMMENT_LENGTH}
          value={draft}
          onChange={setDraft}
          mentions={picked}
          onMentionsChange={setPicked}
          candidates={candidates}
          onSubmit={() => void post()}
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

      {deleteErrorMessage && (
        <p role="alert" className="alert">
          {deleteErrorMessage}
        </p>
      )}

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
              <CommentEntry
                key={entry.id}
                entry={entry}
                now={now}
                onDelete={canDelete(entry) ? () => setPendingDelete(entry) : undefined}
              />
            ) : (
              <SystemEntry key={entry.id} entry={entry} now={now} />
            ),
          )}
        </ol>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this comment?"
          confirmLabel="Delete comment"
          busyLabel="Deleting..."
          confirmVariant="danger"
          onConfirm={() => confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        >
          <p>
            {pendingDelete.author?.id === user?.id ? 'Your comment' : `${pendingDelete.author?.name ?? 'This'}'s comment`}{' '}
            will be removed from this card for everyone. This can't be undone.
          </p>
          <blockquote className="activity-quote">{pendingDelete.text}</blockquote>
        </ConfirmDialog>
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

function CommentEntry({ entry, now, onDelete }: { entry: ActivityEntry; now: number; onDelete?: () => void }) {
  return (
    <li className="activity-comment">
      {entry.author && <MemberAvatar userId={entry.author.id} name={entry.author.name} email={null} size="sm" />}
      <div className="activity-comment-body">
        <div className="activity-meta">
          <strong>{authorName(entry)}</strong>
          <span className="faint">
            <Timestamp date={entry.createdAt} now={now} />
          </span>
          {onDelete && (
            <button
              type="button"
              className="activity-delete"
              aria-label={`Delete comment by ${authorName(entry)}`}
              title="Delete comment"
              onClick={onDelete}
            >
              ×
            </button>
          )}
        </div>
        <p className="activity-text">
          {/* Highlights the people stored as mentioned on this entry — nothing else */}
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
