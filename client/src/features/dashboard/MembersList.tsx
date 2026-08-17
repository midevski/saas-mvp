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
    <div>
      <h2>Members</h2>
      {error && <p role="alert">{error}</p>}
      <ul>
        {members.map((member) => {
          // Mirrors the server rules for a clean UX — the server is the real enforcement point
          const canRemove =
            canManage &&
            member.role !== 'owner' &&
            !(currentRole === 'admin' && member.role === 'admin')

          return (
            <li key={member.userId}>
              {member.name} ({member.email}) — {member.role}
              {canRemove && <button onClick={() => removeMember(member.userId)}>Remove</button>}
              {currentRole === 'owner' && member.role !== 'owner' && (
                <select
                  value={member.role}
                  onChange={(e) => changeRole(member.userId, e.target.value as 'admin' | 'member')}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
