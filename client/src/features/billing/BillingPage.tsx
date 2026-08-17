import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'

interface BillingStatus {
  subscribed: boolean
  status: string | null
  priceId: string | null
  currentPeriodEnd: string | null
}

export function BillingPage() {
  const { orgId } = useParams<{ orgId: string }>()
  const { orgs, currentRole } = useOrg()
  const [searchParams] = useSearchParams()
  const checkoutOutcome = searchParams.get('checkout')

  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [proPriceId, setProPriceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hasPolledOnce = useRef(false)

  const org = orgs.find((o) => o.id === orgId)
  const role = org?.role ?? currentRole

  async function fetchStatus() {
    if (!orgId) return
    const res = await api.get(`/orgs/${orgId}/billing/status`)
    setStatus(res.data)
  }

  useEffect(() => {
    fetchStatus().catch(() => setError('Could not load billing status'))
    api
      .get('/billing/config')
      .then((res) => setProPriceId(res.data.proPriceId))
      .catch(() => setError('Could not load billing configuration'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // Webhook delivery can lag slightly behind the Checkout redirect — refetch once
  useEffect(() => {
    if (checkoutOutcome !== 'success' || hasPolledOnce.current) return
    hasPolledOnce.current = true
    const timer = setTimeout(() => {
      fetchStatus().catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutOutcome, orgId])

  if (!orgId) return null

  async function upgrade() {
    if (!proPriceId) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.post(`/orgs/${orgId}/billing/checkout`, { priceId: proPriceId })
      window.location.href = res.data.url
    } catch {
      setError('Could not start checkout')
      setBusy(false)
    }
  }

  async function manageBilling() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post(`/orgs/${orgId}/billing/portal`)
      window.location.href = res.data.url
    } catch {
      setError('Could not open billing portal')
      setBusy(false)
    }
  }

  return (
    <div>
      <p>
        <Link to="/">Back to dashboard</Link>
      </p>
      <h1>Billing</h1>

      {checkoutOutcome === 'success' && !status?.subscribed && <p>Activating your subscription...</p>}
      {checkoutOutcome === 'cancel' && <p>Checkout was canceled.</p>}
      {error && <p role="alert">{error}</p>}

      {status && (
        <p>
          Status: <strong>{status.subscribed ? 'Subscribed' : 'Not subscribed'}</strong>
          {status.status && ` (${status.status})`}
        </p>
      )}

      {role !== 'owner' ? (
        <p>Only the org owner can manage billing.</p>
      ) : status?.subscribed ? (
        <button onClick={manageBilling} disabled={busy}>
          Manage billing
        </button>
      ) : (
        <button onClick={upgrade} disabled={busy || !proPriceId}>
          Upgrade to Pro
        </button>
      )}
    </div>
  )
}
