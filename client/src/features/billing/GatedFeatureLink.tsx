import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'

// Stands in for the Phase 4 realtime board, which will mount requireSubscription for real
export function GatedFeatureLink() {
  const { currentOrg } = useOrg()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!currentOrg) return
    setSubscribed(null)
    setMessage(null)
    api
      .get(`/orgs/${currentOrg.id}/billing/status`)
      .then((res) => setSubscribed(res.data.subscribed))
      .catch(() => setSubscribed(false))
  }, [currentOrg])

  if (!currentOrg || subscribed === null) return null

  async function openFeature() {
    setMessage(null)
    try {
      const res = await api.get(`/orgs/${currentOrg!.id}/premium-placeholder`)
      setMessage(res.data.message)
    } catch {
      setMessage('This feature requires an active subscription')
    }
  }

  return (
    <div>
      <h2>Premium feature</h2>
      {subscribed ? (
        <button onClick={openFeature}>Open premium feature</button>
      ) : (
        <p>
          This feature requires a paid plan. <Link to={`/orgs/${currentOrg.id}/billing`}>Upgrade</Link>
        </p>
      )}
      {message && <p>{message}</p>}
    </div>
  )
}
