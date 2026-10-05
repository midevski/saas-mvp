import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotifications, type AppNotification } from '../context/NotificationContext'
import { useOrg } from '../context/OrgContext'
import { relativeTime } from '../lib/relativeTime'
import { MemberAvatar } from './MemberAvatar'

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function badgeText(count: number) {
  return count > 9 ? '9+' : String(count)
}

function when(date: string) {
  return Date.now() - new Date(date).getTime() < 60_000 ? 'just now' : relativeTime(date)
}

// Navbar, every signed-in page: a bell with your unread count (live), opening your recent
// notifications. Clicking one marks it read and takes you to the card (and comment) it's about.
export function NotificationBell() {
  const { unreadCount, notifications, hasMore, loadNotifications, loadMore, markAsRead, markAllAsRead } =
    useNotifications()
  const { orgs, switchOrg } = useOrg()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on a click outside or Escape (same as the account menu)
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  function toggle() {
    const opening = !isOpen
    setIsOpen(opening)
    if (opening) {
      setLoadFailed(false)
      // Refresh every time it opens, so it's current even if live events were missed
      loadNotifications().catch(() => setLoadFailed(true))
    }
  }

  function open(notification: AppNotification) {
    setIsOpen(false)
    if (!notification.read) void markAsRead(notification.id)
    if (orgs.some((o) => o.id === notification.orgId)) switchOrg(notification.orgId)
    const params = new URLSearchParams({ card: notification.cardId, comment: notification.activityId })
    navigate(`/orgs/${notification.orgId}/board?${params}`)
  }

  async function showMore() {
    setLoadingMore(true)
    try {
      await loadMore()
    } catch {
      setLoadFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'

  return (
    <div className="notif" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="notif-button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {badgeText(unreadCount)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-header">
            <strong>Notifications</strong>
            <button
              type="button"
              className="link-button notif-mark-all"
              disabled={unreadCount === 0}
              onClick={() => void markAllAsRead()}
            >
              Mark all as read
            </button>
          </div>

          {loadFailed && (
            <p role="alert" className="notif-empty">
              Couldn't load notifications. Try again in a moment.
            </p>
          )}
          {!notifications && !loadFailed && <p className="notif-empty">Loading...</p>}
          {notifications && notifications.length === 0 && (
            <p className="notif-empty">You're all caught up. When someone @mentions you, it shows up here.</p>
          )}

          {notifications && notifications.length > 0 && (
            <ul className="notif-list">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`notif-item${n.read ? '' : ' is-unread'}`}
                    onClick={() => open(n)}
                  >
                    <MemberAvatar userId={n.actor.id} name={n.actor.name} email={null} size="sm" />
                    <span className="notif-item-body">
                      <span className="notif-item-text">
                        {!n.read && <span className="sr-only">Unread: </span>}
                        {n.text}
                      </span>
                      <time className="notif-item-time" dateTime={n.createdAt}>
                        {when(n.createdAt)}
                      </time>
                    </span>
                    {!n.read && <span className="notif-unread-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {hasMore && (
            <button type="button" className="notif-more" disabled={loadingMore} onClick={() => void showMore()}>
              {loadingMore ? 'Loading...' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
