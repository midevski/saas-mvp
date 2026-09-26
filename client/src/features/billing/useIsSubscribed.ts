import { useEffect, useState } from 'react'
import { api } from '../../lib/api/axiosInstance'

// null while loading. Reads the cached status from GET /orgs/:orgId/billing/status —
// the same check BillingPage uses; the server still enforces it independently.
export function useIsSubscribed(orgId: string | undefined): boolean | null {
  const [result, setResult] = useState<{ orgId: string; subscribed: boolean } | null>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    api
      .get(`/orgs/${orgId}/billing/status`)
      .then((res) => !cancelled && setResult({ orgId, subscribed: res.data.subscribed }))
      .catch(() => !cancelled && setResult({ orgId, subscribed: false }))
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Ignore a result left over from a previously viewed org
  return result && result.orgId === orgId ? result.subscribed : null
}
