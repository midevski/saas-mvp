import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'
import { PageHeader } from '../../components/PageHeader'

const PRO_FEATURES = [
  'Realtime collaborative board for the whole team',
  'Changes sync live across every teammate and tab',
  'Manage or cancel anytime from the billing portal',
]

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

  const renewsOn = status?.currentPeriodEnd ? new Date(status.currentPeriodEnd).toLocaleDateString() : null

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Plan & subscription"
        lede={org ? `Subscription for ${org.name}` : undefined}
      />

      <div className="stack" style={{ maxWidth: '44rem' }}>
        {checkoutOutcome === 'success' && !status?.subscribed && (
          <p className="notice">Activating your subscription...</p>
        )}
        {checkoutOutcome === 'cancel' && <p className="notice">Checkout was canceled.</p>}
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <span className="eyebrow">Current plan</span>
              <h2>{status?.subscribed ? 'Pro' : 'Free'}</h2>
            </div>
            {status && (
              <span className={status.subscribed ? 'pill pill-success' : 'pill'}>
                <span className={status.subscribed ? 'dot dot-live' : 'dot dot-off'} />
                {status.status ?? (status.subscribed ? 'active' : 'not subscribed')}
              </span>
            )}
          </div>
          <div className="card-body stack">
            <ul className="stack" style={{ gap: 10 }}>
              {PRO_FEATURES.map((feature) => (
                <li key={feature} className="row" style={{ gap: 12 }}>
                  <span className="dot" />
                  {feature}
                </li>
              ))}
            </ul>
            {renewsOn && (
              <p className="mono faint" style={{ fontSize: '0.8125rem' }}>
                Current period ends {renewsOn}
              </p>
            )}
            <div className="row" style={{ paddingTop: 8, borderTop: '1px solid var(--color-line)' }}>
              {role !== 'owner' ? (
                <p className="muted" style={{ fontSize: '0.875rem', paddingTop: 8 }}>
                  Only the org owner can manage billing.
                </p>
              ) : status?.subscribed ? (
                <button className="btn btn-outline" onClick={manageBilling} disabled={busy} style={{ marginTop: 8 }}>
                  Manage billing
                </button>
              ) : (
                <button
                  className="btn btn-accent"
                  onClick={upgrade}
                  disabled={busy || !proPriceId}
                  style={{ marginTop: 8 }}
                >
                  Upgrade to Pro
                </button>
              )}
            </div>
          </div>
        </section>

        <p className="mono faint" style={{ fontSize: '0.75rem' }}>
          Payments run in Stripe test mode — use card 4242 4242 4242 4242.
        </p>
      </div>
    </>
  )
}
