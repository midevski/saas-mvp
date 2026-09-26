import { useEffect, useRef, useState, type FormEvent } from 'react'
import axios from 'axios'
import { api } from '../../lib/api/axiosInstance'
import { relativeTime } from '../../lib/relativeTime'
import { CopyButton } from '../../components/CopyButton'

type InviteRole = 'member' | 'admin'

// Ownership isn't transferable via invite, so 'owner' is deliberately not offered
const ROLE_OPTIONS: { value: InviteRole; title: string; description: string }[] = [
  { value: 'member', title: 'Member', description: 'Can see the team and use the board.' },
  { value: 'admin', title: 'Admin', description: 'Everything a member can, plus invite and remove members.' },
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface CreatedInvite {
  email: string
  role: InviteRole
  inviteLink: string
  expiresAt: string
}

interface InviteModalProps {
  orgId: string
  orgName: string
  onClose: () => void
  onInvited: () => void
}

function describeError(err: unknown, email: string): string {
  if (!axios.isAxiosError(err) || !err.response) return 'Could not reach the server. Check your connection and try again.'
  switch (err.response.status) {
    case 409:
      return `${email} is already a member of this organization.`
    case 400:
      return 'The server rejected that email address. Please check it and try again.'
    case 403:
    case 404:
      return "You don't have permission to invite people to this organization."
    case 429:
      return 'Too many invites in a short time. Please wait a moment and try again.'
    default:
      return 'Something went wrong while creating the invite. Please try again.'
  }
}

// Rendered only while open (see InviteButton), so each opening starts from a clean form
export function InviteModal({ orgId, orgName, onClose, onInvited }: InviteModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedInvite | null>(null)

  // Native <dialog> gives focus trapping, Esc-to-close and a backdrop for free
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)

    const trimmed = email.trim()
    if (!EMAIL_PATTERN.test(trimmed)) {
      // Caught client-side: no request is sent
      setEmailError(trimmed ? 'Enter a valid email address, like name@company.com.' : 'Enter an email address.')
      emailRef.current?.focus()
      return
    }
    setEmailError(null)

    setBusy(true)
    try {
      const res = await api.post(`/orgs/${orgId}/invites`, { email: trimmed, role })
      setCreated({ email: trimmed, role, inviteLink: res.data.inviteLink, expiresAt: res.data.expiresAt })
      onInvited()
    } catch (err) {
      setServerError(describeError(err, trimmed))
    } finally {
      setBusy(false)
    }
  }

  function inviteAnother() {
    setCreated(null)
    setEmail('')
    setRole('member')
    // Wait for the form to re-render before focusing
    setTimeout(() => emailRef.current?.focus(), 0)
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="invite-modal-title"
      // React bubbles onClose from nested dialogs; only react to this dialog closing itself
      onClose={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">{orgName}</span>
          <h2 id="invite-modal-title">{created ? 'Invite link ready' : 'Invite a teammate'}</h2>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
          ×
        </button>
      </div>

      {created ? (
        // Stays open after success: the next step is almost always copying the link
        <>
          <div className="card-body stack">
            <div className="success-banner" role="status">
              <span className="dot dot-live" style={{ marginTop: 7 }} />
              <p>
                Invite created for <strong>{created.email}</strong> as {created.role === 'admin' ? 'an admin' : 'a member'}.
              </p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="invite-link">
                Invite link
              </label>
              <div className="copy-field">
                <input
                  id="invite-link"
                  className="input"
                  readOnly
                  value={created.inviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton text={created.inviteLink} className="btn btn-accent" />
              </div>
            </div>
            <p className="muted" style={{ fontSize: '0.875rem' }}>
              Email sending isn't set up yet, so share this link with them directly. They'll need to sign in with{' '}
              {created.email}. The link expires {relativeTime(created.expiresAt)}.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={inviteAnother}>
              Invite another
            </button>
            <button type="button" className="btn btn-ink" onClick={() => dialogRef.current?.close()}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="card-body stack">
            <div className="field">
              <label className="field-label" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                ref={emailRef}
                className="input"
                type="email"
                autoComplete="off"
                autoFocus
                placeholder="teammate@company.com"
                value={email}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? 'invite-email-error' : undefined}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailError) setEmailError(null)
                }}
              />
              {emailError && (
                <p id="invite-email-error" className="field-error">
                  {emailError}
                </p>
              )}
            </div>

            <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="field-label" style={{ marginBottom: 6 }}>
                Role
              </legend>
              <div className="role-options">
                {ROLE_OPTIONS.map((option) => (
                  <label key={option.value} className="role-option">
                    <input
                      type="radio"
                      name="invite-role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                    />
                    <span>
                      <span className="role-option-title">{option.title}</span>
                      <span className="role-option-desc">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {serverError && (
              <p role="alert" className="alert">
                {serverError}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn-accent" disabled={busy}>
              {busy ? 'Creating...' : 'Create invite link'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
