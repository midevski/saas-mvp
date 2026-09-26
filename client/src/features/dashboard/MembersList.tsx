import { useEffect, useState } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'

interface Member {
  userId: string
  email: string | null
  name: string | null
  role: 'owner' | 'admin' | 'member'
}

export function MembersList() {
  const { currentOrg, currentRole } = useOrg()
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  // A role change waits here for confirmation; nothing is saved until the dialog is confirmed
  const [pendingRoleChange, setPendingRoleChange] = useState<{ member: Member; role: 'admin' | 'member' } | null>(
    null,
  )
  // Same for removals — the member stays until the dialog is confirmed
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null)

  const canManage = currentRole === 'owner' || currentRole === 'admin'

  useEffect(() => {
    if (!currentOrg) return
    api
      .get(`/orgs/${currentOrg.id}/members`)
      .then((res) => setMembers(res.data.members))
      .catch(() => setError('Could not load members'))
  }, [currentOrg])

  if (!currentOrg) return null

  async function removeMember(userId: string) {
    setError(null)
    try {
      await api.delete(`/orgs/${currentOrg!.id}/members/${userId}`)
      setMembers((prev) => prev.filter((m) => m.userId !== userId))
    } catch {
      setError('Could not remove member')
    } finally {
      setPendingRemoval(null)
    }
  }

  async function changeRole(userId: string, role: 'admin' | 'member') {
    setError(null)
    try {
      await api.patch(`/orgs/${currentOrg!.id}/members/${userId}`, { role })
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)))
    } catch {
      setError('Could not change role')
    } finally {
      setPendingRoleChange(null)
    }
  }

  const nameOf = (member: Member | undefined) => member?.name ?? member?.email ?? 'This member'
  const pendingName = nameOf(pendingRoleChange?.member)

  return (
    <section className="card">
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">Team</span>
          <h2>Members</h2>
        </div>
        <span className="pill">{members.length}</span>
      </div>
      {error && (
        <div style={{ padding: '16px 24px 0' }}>
          <p role="alert" className="alert">
            {error}
          </p>
        </div>
      )}
      <ul className="list">
        {members.map((member) => {
          // Mirrors the server rules for a clean UX — the server is the real enforcement point
          const canRemove =
            canManage &&
            member.role !== 'owner' &&
            !(currentRole === 'admin' && member.role === 'admin')

          return (
            <li key={member.userId}>
              <span className="avatar">{(member.name ?? member.email ?? '?').charAt(0).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{member.name}</div>
                <div className="faint mono" style={{ fontSize: '0.75rem', overflowWrap: 'anywhere' }}>
                  {member.email}
                </div>
              </div>
              {currentRole === 'owner' && member.role !== 'owner' ? (
                <select
                  className="select select-sm"
                  aria-label={`Role for ${member.name}`}
                  // Controlled by the saved role, so it snaps back unless the change is confirmed
                  value={member.role}
                  onChange={(e) => setPendingRoleChange({ member, role: e.target.value as 'admin' | 'member' })}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className={member.role === 'owner' ? 'pill pill-ink' : 'pill'}>{member.role}</span>
              )}
              {canRemove && (
                <button className="btn btn-danger btn-sm" onClick={() => setPendingRemoval(member)}>
                  Remove
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {pendingRoleChange && (
        <ConfirmDialog
          title={`Change ${pendingName}'s role?`}
          confirmLabel={pendingRoleChange.role === 'admin' ? 'Make admin' : 'Make member'}
          onConfirm={() => changeRole(pendingRoleChange.member.userId, pendingRoleChange.role)}
          onCancel={() => setPendingRoleChange(null)}
        >
          <p>
            <strong>{pendingName}</strong> will go from{' '}
            <span className="pill">{pendingRoleChange.member.role}</span> to{' '}
            <span className="pill pill-accent">{pendingRoleChange.role}</span> in {currentOrg.name}.
          </p>
          <p className="muted" style={{ fontSize: '0.9375rem' }}>
            {pendingRoleChange.role === 'admin'
              ? 'Admins can invite new people and remove members from this organization.'
              : "They'll no longer be able to invite people or remove members."}
          </p>
        </ConfirmDialog>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove ${nameOf(pendingRemoval)} from ${currentOrg.name}?`}
          confirmLabel="Remove member"
          onConfirm={() => removeMember(pendingRemoval.userId)}
          onCancel={() => setPendingRemoval(null)}
        >
          <p>
            <strong>{nameOf(pendingRemoval)}</strong>
            {pendingRemoval.email && pendingRemoval.name && <span className="muted"> ({pendingRemoval.email})</span>}{' '}
            will lose access to {currentOrg.name}, including its board.
          </p>
          <p className="muted" style={{ fontSize: '0.9375rem' }}>
            Their account isn't deleted. To bring them back, you'll need to send them a new invite.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}
