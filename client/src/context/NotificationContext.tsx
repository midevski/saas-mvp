import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../lib/api/axiosInstance'
import { NOTIFICATION_NEW, NOTIFICATION_READ } from '../lib/socketEvents'
import { useAuth } from './AuthContext'
import { useSocket } from './SocketContext'

export interface AppNotification {
  id: string
  type: 'mention'
  actor: { id: string; name: string }
  orgId: string
  cardId: string
  activityId: string
  text: string
  read: boolean
  createdAt: string
}

interface NotificationContextValue {
  unreadCount: number
  // null until first loaded (the bell loads them when it's opened)
  notifications: AppNotification[] | null
  hasMore: boolean
  loadNotifications: () => Promise<void>
  loadMore: () => Promise<void>
  markAsRead: (id: string) => Promise<void>
  markAllAsRead: () => Promise<void>
}

// Tagged with the user it belongs to, so logging out or switching users never shows the
// previous user's notifications — no reset effect needed (same approach as OrgContext)
interface NotificationState {
  userId: string
  unreadCount: number
  notifications: AppNotification[] | null
  nextCursor: string | null
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

// New ones first; the same notification may arrive both live and in a fetched page
function mergeNewestFirst(current: AppNotification[], incoming: AppNotification[]) {
  const byId = new Map(current.map((n) => [n.id, n]))
  for (const n of incoming) byId.set(n.id, { ...n, read: n.read || (byId.get(n.id)?.read ?? false) })
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

const PAGE_SIZE = 20

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { socket } = useSocket()
  const userId = user?.id ?? null
  const [state, setState] = useState<NotificationState | null>(null)

  // Only touch state that belongs to the current user
  const update = useCallback(
    (fn: (s: NotificationState) => NotificationState) => {
      if (!userId) return
      setState((prev) =>
        fn(prev?.userId === userId ? prev : { userId, unreadCount: 0, notifications: null, nextCursor: null }),
      )
    },
    [userId],
  )

  const refreshCount = useCallback(async () => {
    if (!userId) return
    try {
      const res = await api.get('/notifications/unread-count')
      update((s) => ({ ...s, unreadCount: res.data.count }))
    } catch {
      // Keep the last known count; the next reconnect or event refreshes it
    }
  }, [userId, update])

  const loadNotifications = useCallback(async () => {
    if (!userId) return
    const res = await api.get('/notifications', { params: { limit: PAGE_SIZE } })
    update((s) => ({
      ...s,
      notifications: mergeNewestFirst(s.notifications ?? [], res.data.notifications),
      // Keep an older cursor if more pages were already loaded
      nextCursor: s.notifications && s.notifications.length > PAGE_SIZE ? s.nextCursor : res.data.nextCursor,
    }))
  }, [userId, update])

  const loadMore = useCallback(async () => {
    const cursor = state?.userId === userId ? state.nextCursor : null
    if (!cursor) return
    const res = await api.get('/notifications', { params: { limit: PAGE_SIZE, before: cursor } })
    update((s) => ({
      ...s,
      notifications: mergeNewestFirst(s.notifications ?? [], res.data.notifications),
      nextCursor: res.data.nextCursor,
    }))
  }, [state, userId, update])

  // Signed in: get the count right away (the bell shows it on every page)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    api
      .get('/notifications/unread-count')
      .then((res) => !cancelled && update((s) => ({ ...s, unreadCount: res.data.count })))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId, update])

  useEffect(() => {
    if (!userId) return
    const onNew = ({ notification }: { notification: AppNotification }) => {
      update((s) => {
        const known = s.notifications?.some((n) => n.id === notification.id)
        return {
          ...s,
          unreadCount: known || notification.read ? s.unreadCount : s.unreadCount + 1,
          notifications: s.notifications && mergeNewestFirst(s.notifications, [notification]),
        }
      })
    }
    // Read somewhere else (another tab): mirror it, and take the server's count
    const onRead = (payload: { notificationIds?: string[]; all?: boolean }) => {
      const ids = new Set(payload.notificationIds ?? [])
      update((s) => ({
        ...s,
        notifications:
          s.notifications && s.notifications.map((n) => (payload.all || ids.has(n.id) ? { ...n, read: true } : n)),
      }))
      void refreshCount()
    }
    // Anything missed while disconnected
    const onConnect = () => void refreshCount()
    socket.on(NOTIFICATION_NEW, onNew)
    socket.on(NOTIFICATION_READ, onRead)
    socket.on('connect', onConnect)
    return () => {
      socket.off(NOTIFICATION_NEW, onNew)
      socket.off(NOTIFICATION_READ, onRead)
      socket.off('connect', onConnect)
    }
  }, [socket, userId, update, refreshCount])

  const markAsRead = useCallback(
    async (id: string) => {
      // Instant in the UI; the response carries the authoritative count
      update((s) => {
        const target = s.notifications?.find((n) => n.id === id)
        return {
          ...s,
          unreadCount: target && !target.read ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
          notifications: s.notifications && s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        }
      })
      try {
        const res = await api.patch(`/notifications/${id}/read`)
        update((s) => ({ ...s, unreadCount: res.data.count }))
      } catch {
        void refreshCount()
      }
    },
    [update, refreshCount],
  )

  const markAllAsRead = useCallback(async () => {
    update((s) => ({
      ...s,
      unreadCount: 0,
      notifications: s.notifications && s.notifications.map((n) => ({ ...n, read: true })),
    }))
    try {
      await api.patch('/notifications/read-all')
    } catch {
      void refreshCount()
    }
  }, [update, refreshCount])

  const mine = state && state.userId === userId ? state : null

  return (
    <NotificationContext.Provider
      value={{
        unreadCount: mine?.unreadCount ?? 0,
        notifications: mine?.notifications ?? null,
        hasMore: !!mine?.nextCursor,
        loadNotifications,
        loadMore,
        markAsRead,
        markAllAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
