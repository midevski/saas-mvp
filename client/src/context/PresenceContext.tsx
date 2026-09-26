import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api/axiosInstance'
import { PRESENCE_UPDATE } from '../lib/socketEvents'
import { useSocket } from './SocketContext'

export interface OrgMember {
  userId: string
  name: string | null
  email: string | null
  role: 'owner' | 'admin' | 'member'
}

interface PresenceContextValue {
  onlineMembers: OrgMember[]
  offlineMembers: OrgMember[]
  isLoaded: boolean
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

// Tagged with the org it belongs to, so switching boards never shows the previous org's data
interface OrgScoped<T> {
  orgId: string
  value: T
}

// Board-scoped: mounted by the board page for the org being viewed. Online IDs come from
// the socket (`presence:update`); names and roles come from the org's member list.
export function PresenceProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const { socket } = useSocket()
  const [online, setOnline] = useState<OrgScoped<string[]> | null>(null)
  const [members, setMembers] = useState<OrgScoped<OrgMember[]> | null>(null)
  const [membersVersion, setMembersVersion] = useState(0)
  const refetchedFor = useRef<string | null>(null)

  useEffect(() => {
    const onUpdate = ({ onlineUserIds }: { onlineUserIds: string[] }) =>
      setOnline({ orgId, value: onlineUserIds })
    socket.on(PRESENCE_UPDATE, onUpdate)
    return () => {
      socket.off(PRESENCE_UPDATE, onUpdate)
    }
  }, [socket, orgId])

  useEffect(() => {
    let cancelled = false
    api
      .get(`/orgs/${orgId}/members`)
      .then((res) => !cancelled && setMembers({ orgId, value: res.data.members }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [orgId, membersVersion])

  const onlineIds = useMemo(() => (online?.orgId === orgId ? online.value : []), [online, orgId])
  const memberList = useMemo(() => (members?.orgId === orgId ? members.value : null), [members, orgId])

  // Someone online who isn't in our list joined the org after we loaded it — refetch once for them
  useEffect(() => {
    if (!memberList) return
    const unknown = onlineIds.filter((id) => !memberList.some((m) => m.userId === id))
    const key = `${orgId}:${unknown.join(',')}`
    if (unknown.length === 0 || refetchedFor.current === key) return
    refetchedFor.current = key
    const timer = setTimeout(() => setMembersVersion((v) => v + 1), 0)
    return () => clearTimeout(timer)
  }, [onlineIds, memberList, orgId])

  const value = useMemo<PresenceContextValue>(() => {
    const onlineSet = new Set(onlineIds)
    const all = memberList ?? []
    return {
      onlineMembers: all.filter((m) => onlineSet.has(m.userId)),
      // Every other member of the org, including those who have never opened the board
      offlineMembers: all.filter((m) => !onlineSet.has(m.userId)),
      isLoaded: memberList !== null,
    }
  }, [onlineIds, memberList])

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

export function usePresence() {
  const ctx = useContext(PresenceContext)
  if (!ctx) throw new Error('usePresence must be used within PresenceProvider')
  return ctx
}
