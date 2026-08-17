import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'

export function InviteForm() {
  const { currentOrg } = useOrg()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!currentOrg) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInviteLink(null)
    try {
      const res = await api.post(`/orgs/${currentOrg!.id}/invites`, { email, role })
      setInviteLink(res.data.inviteLink)
      setEmail('')
    } catch {
      setError('Could not create invite')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Invite a teammate</h2>
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Send invite</button>
      {inviteLink && (
        <p>
          No email sending yet (Future work) — share this link: <code>{inviteLink}</code>
        </p>
      )}
    </form>
  )
}
