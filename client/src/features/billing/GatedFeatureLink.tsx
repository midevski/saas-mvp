import { Link } from 'react-router-dom'
import { useOrg } from '../../context/OrgContext'
import { useIsSubscribed } from './useIsSubscribed'

// Entry point to the Pro-only realtime board: shows an upgrade prompt instead when unsubscribed
export function GatedFeatureLink() {
  const { currentOrg } = useOrg()
  const subscribed = useIsSubscribed(currentOrg?.id)

  if (!currentOrg || subscribed === null) return null

  return (
    <div>
      <h2>Collaborative board</h2>
      {subscribed ? (
        <Link to={`/orgs/${currentOrg.id}/board`}>Open board</Link>
      ) : (
        <p>
          The collaborative board requires the Pro plan.{' '}
          <Link to={`/orgs/${currentOrg.id}/billing`}>Upgrade</Link>
        </p>
      )}
    </div>
  )
}
