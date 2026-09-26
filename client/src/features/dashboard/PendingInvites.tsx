import { useEffect, useState } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { relativeTime } from '../../lib/relativeTime'
import { useOrg } from '../../context/OrgContext'
import { CopyButton } from '../../components/CopyButton'

interface PendingInvite {
  id: string
  email: string
  role: 'admin' | 'member'
  expiresAt: string
  inviteLink: string
}

// Tagged with the org + refresh it was loaded for, so switching orgs never shows stale invites
interface LoadedInvites {
  key: string
  invites: PendingInvite[] | null
}

// `refreshKey` changes whenever a new invite is created, so the list refetches
export function PendingInvites({ refreshKey }: { refreshKey: number }) {
  const { currentOrg, currentRole } = useOrg()
  const canManage = currentRole === 'owner' || currentRole === 'admin'
  const orgId = currentOrg?.id
  const key = `${orgId}:${refreshKey}`

  const [loaded, setLoaded] = useState<LoadedInvites | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !canManage) return
    let cancelled = false
    api
      .get(`/orgs/${orgId}/invites`, { params: { status: 'pending' } })
      .then((res) => !cancelled && setLoaded({ key, invites: res.data.invites }))
      .catch(() => !cancelled && setLoaded({ key, invites: null }))
    return () => {
      cancelled = true
    }
  }, [orgId, canManage, key])

  // Hidden from plain members, matching the owner/admin-only endpoint
  if (!currentOrg || !canManage) return null

  const invites = loaded?.key === key ? loaded.invites : undefined

  async function revoke(inviteId: string) {
    setError(null)
    setConfirmingId(null)
    try {
      await api.delete(`/orgs/${currentOrg!.id}/invites/${inviteId}`)
      setLoaded((prev) => prev && { ...prev, invites: prev.invites?.filter((i) => i.id !== inviteId) ?? null })
    } catch {
      setError('Could not revoke that invite')
    }
  }

  return (
    <section className="card" aria-labelledby="pending-invites-title">
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">Team</span>
          <h2 id="pending-invites-title">Pending invites</h2>
        </div>
        {invites && <span className="pill">{invites.length}</span>}
      </div>

      {error && (
        <div style={{ padding: '16px 24px 0' }}>
          <p role="alert" className="alert">
            {error}
          </p>
        </div>
      )}

      {invites === undefined ? (
        <p className="card-body eyebrow">Loading...</p>
      ) : invites === null ? (
        <p className="card-body muted">Could not load pending invites.</p>
      ) : invites.length === 0 ? (
        <p className="card-body muted" style={{ fontSize: '0.9375rem' }}>
          No pending invites. Use <strong>Invite</strong> to add someone to this organization.
        </p>
      ) : (
        <ul className="list">
          {invites.map((invite) => (
            <li key={invite.id} style={{ flexWrap: 'wrap' }}>
              <span className="avatar" aria-hidden="true">
                @
              </span>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{invite.email}</div>
                <div className="faint mono" style={{ fontSize: '0.75rem' }}>
                  {invite.role} · expires {relativeTime(invite.expiresAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <CopyButton text={invite.inviteLink} />
                {confirmingId === invite.id ? (
                  <>
                    <button className="btn btn-accent btn-sm" onClick={() => revoke(invite.id)}>
                      Confirm revoke
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => setConfirmingId(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmingId(invite.id)}>
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
