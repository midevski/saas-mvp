import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api } from '../lib/api/axiosInstance'

export interface OrgSummary {
  id: string
  name: string
  slug: string
  role: 'owner' | 'admin' | 'member'
}

interface OrgContextValue {
  orgs: OrgSummary[]
  currentOrg: OrgSummary | null
  currentRole: OrgSummary['role'] | null
  isLoading: boolean
  switchOrg: (orgId: string) => void
  refreshOrgs: () => Promise<void>
}

// Tagged with the user it was loaded for, so a logout or user switch never shows the
// previous user's orgs — no effect needed to reset it
interface OrgState {
  userId: string
  orgs: OrgSummary[]
  currentOrgId: string | null
}

const OrgContext = createContext<OrgContextValue | null>(null)

// A failed fetch is treated as "no orgs" rather than loading forever
function fetchOrgs(): Promise<OrgSummary[]> {
  return api
    .get('/orgs')
    .then((res) => res.data.orgs as OrgSummary[])
    .catch(() => [])
}

// Keeps the selected org if it still exists, otherwise falls back to the first one
function nextState(prev: OrgState | null, userId: string, orgs: OrgSummary[]): OrgState {
  const current = prev?.userId === userId ? prev.currentOrgId : null
  return {
    userId,
    orgs,
    currentOrgId: current && orgs.some((org) => org.id === current) ? current : (orgs[0]?.id ?? null),
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [state, setState] = useState<OrgState | null>(null)

  const refreshOrgs = useCallback(async () => {
    if (!userId) return
    const orgs = await fetchOrgs()
    setState((prev) => nextState(prev, userId, orgs))
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchOrgs().then((orgs) => {
      if (!cancelled) setState((prev) => nextState(prev, userId, orgs))
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const switchOrg = useCallback((orgId: string) => {
    setState((prev) => (prev ? { ...prev, currentOrgId: orgId } : prev))
  }, [])

  const mine = state && state.userId === userId ? state : null
  const orgs = mine?.orgs ?? []
  const currentOrg = orgs.find((org) => org.id === mine?.currentOrgId) ?? null

  return (
    <OrgContext.Provider
      value={{
        orgs,
        currentOrg,
        currentRole: currentOrg?.role ?? null,
        isLoading: userId !== null && mine === null,
        switchOrg,
        refreshOrgs,
      }}
    >
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used within OrgProvider')
  return ctx
}
