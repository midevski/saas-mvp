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

const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState<OrgSummary[]>([])
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshOrgs = useCallback(async () => {
    const res = await api.get('/orgs')
    const fetched: OrgSummary[] = res.data.orgs
    setOrgs(fetched)
    setCurrentOrgId((current) =>
      current && fetched.some((org) => org.id === current) ? current : (fetched[0]?.id ?? null),
    )
  }, [])

  useEffect(() => {
    if (!user) {
      setOrgs([])
      setCurrentOrgId(null)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    refreshOrgs().finally(() => setIsLoading(false))
  }, [user, refreshOrgs])

  const currentOrg = orgs.find((org) => org.id === currentOrgId) ?? null

  return (
    <OrgContext.Provider
      value={{
        orgs,
        currentOrg,
        currentRole: currentOrg?.role ?? null,
        isLoading,
        switchOrg: setCurrentOrgId,
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
