import { useEffect, useState } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'

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
    }
  }

  async function changeRole(userId: string, role: 'admin' | 'member') {
    setError(null)
    try {
      await api.patch(`/orgs/${currentOrg!.id}/members/${userId}`, { role })
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role } : m)))
    } catch {
      setError('Could not change role')
    }
  }

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
                  value={member.role}
                  onChange={(e) => changeRole(member.userId, e.target.value as 'admin' | 'member')}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span className={member.role === 'owner' ? 'pill pill-ink' : 'pill'}>{member.role}</span>
              )}
              {canRemove && (
                <button className="btn btn-danger btn-sm" onClick={() => removeMember(member.userId)}>
                  Remove
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
