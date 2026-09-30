import { useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useOrg, type OrgSummary } from '../../context/OrgContext'
import { ConfirmDialog } from '../../components/ConfirmDialog'

function deleteErrorMessage(err: unknown) {
  if (!axios.isAxiosError(err) || !err.response) return 'Could not reach the server. Nothing was deleted.'
  const message = (err.response.data as { error?: string } | undefined)?.error
  return message ?? 'Could not delete the organization. Nothing was deleted.'
}

// Owner only (the server enforces it too). Deleting takes the whole org with it, so the dialog
// spells out what's lost and only enables the button once the org's name is typed exactly.
export function DeleteOrgCard({ org }: { org: OrgSummary }) {
  const { refreshOrgs } = useOrg()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (org.role !== 'owner') return null

  function close() {
    setIsOpen(false)
    setTypedName('')
    setError(null)
  }

  async function deleteOrg() {
    setError(null)
    try {
      await api.delete(`/orgs/${org.id}`, { data: { confirmName: typedName } })
    } catch (err) {
      setError(deleteErrorMessage(err))
      return
    }
    close()
    await refreshOrgs()
    navigate('/')
  }

  return (
    <section className="card card-danger" aria-labelledby="danger-zone-title">
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">Danger zone</span>
          <h2 id="danger-zone-title">Delete this organization</h2>
        </div>
      </div>
      <div className="card-body stack">
        <p className="muted">
          Permanently deletes <strong>{org.name}</strong>, its board and everything on it, and cancels its
          subscription. This can't be undone.
        </p>
        <div>
          <button type="button" className="btn btn-danger-solid" onClick={() => setIsOpen(true)}>
            Delete organization
          </button>
        </div>
      </div>

      {isOpen && (
        <ConfirmDialog
          title={`Delete ${org.name}?`}
          confirmLabel="Delete this organization"
          busyLabel="Deleting..."
          confirmVariant="danger"
          confirmDisabled={typedName.trim() !== org.name}
          onConfirm={deleteOrg}
          onCancel={close}
        >
          <p>This permanently deletes the organization and cannot be undone:</p>
          <ul className="danger-list">
            <li>Every member loses access immediately.</li>
            <li>The board, its columns, cards, checklists and images are deleted.</li>
            <li>Pending invites stop working.</li>
            <li>An active subscription is canceled right away, with no refund for the rest of the period.</li>
          </ul>
          <label className="field">
            <span className="field-label">
              Type <strong>{org.name}</strong> to confirm
            </span>
            <input
              className="input"
              aria-label="Organization name"
              autoComplete="off"
              spellCheck={false}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  )
}
