import { Link } from 'react-router-dom'
import { useOrg } from '../../context/OrgContext'
import { useIsSubscribed } from './useIsSubscribed'

// Entry point to the Pro-only realtime board: shows an upgrade prompt instead when unsubscribed
export function GatedFeatureLink() {
  const { currentOrg } = useOrg()
  const subscribed = useIsSubscribed(currentOrg?.id)

  if (!currentOrg || subscribed === null) return null

  return (
    <section className="card-ink">
      <div className="blueprint-ink" />
      <div className="glow" style={{ top: '-10rem', right: '-10rem' }} />
      <div className="card-body stack">
        <p className="eyebrow">
          <span className="dot" />
          {subscribed ? 'Pro · Realtime' : 'Pro feature'}
        </p>
        <h2>Collaborative board</h2>
        <p className="muted" style={{ fontSize: '0.9375rem' }}>
          {subscribed
            ? 'Create, move and edit cards with your team — everyone sees changes instantly.'
            : 'Upgrade to the Pro plan to unlock a live kanban board for your whole team.'}
        </p>
        <div>
          {subscribed ? (
            <Link to={`/orgs/${currentOrg.id}/board`} className="btn btn-accent">
              Open board →
            </Link>
          ) : (
            <Link to={`/orgs/${currentOrg.id}/billing`} className="btn btn-accent">
              Upgrade to Pro
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
