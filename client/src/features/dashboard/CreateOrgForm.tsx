import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { useOrg } from '../../context/OrgContext'

export function CreateOrgForm() {
  const { refreshOrgs, switchOrg } = useOrg()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await api.post('/orgs', { name })
      await refreshOrgs()
      switchOrg(res.data.org.id)
      setName('')
    } catch {
      setError('Could not create organization')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">New</span>
          <h2>Create an organization</h2>
        </div>
      </div>
      <div className="card-body stack">
        <div className="form-row">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              required
              placeholder="Acme Inc."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-ink">
            Create
          </button>
        </div>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
