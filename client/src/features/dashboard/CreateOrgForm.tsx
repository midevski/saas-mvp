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
    <form onSubmit={handleSubmit}>
      <h2>Create an organization</h2>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create</button>
    </form>
  )
}
