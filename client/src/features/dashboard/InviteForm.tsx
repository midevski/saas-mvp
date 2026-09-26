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
    <form onSubmit={handleSubmit} className="card">
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">Team</span>
          <h2>Invite a teammate</h2>
        </div>
      </div>
      <div className="card-body stack">
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            required
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="form-row">
          <label className="field">
            <span className="field-label">Role</span>
            <select
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="btn btn-ink">
            Send invite
          </button>
        </div>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {inviteLink && (
          <div className="notice stack" style={{ gap: 8 }}>
            <span>No email sending yet (Future work) — share this link:</span>
            <code>{inviteLink}</code>
          </div>
        )}
      </div>
    </form>
  )
}
