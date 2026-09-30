import { useState } from 'react'
import { useOrg } from '../../context/OrgContext'
import { InviteModal } from './InviteModal'

interface InviteButtonProps {
  // Org-scoped pages (e.g. the board) pass the org from the URL; otherwise the selected org is used
  orgId?: string
  onInvited?: () => void
  compact?: boolean // navbar size
}

// Mirrors the server rule (owner/admin only) for a clean UX — the server is the real enforcement point
export function InviteButton({ orgId, onInvited, compact = false }: InviteButtonProps) {
  const { orgs, currentOrg } = useOrg()
  const [isOpen, setIsOpen] = useState(false)

  const org = orgId ? orgs.find((o) => o.id === orgId) : currentOrg
  if (!org || (org.role !== 'owner' && org.role !== 'admin')) return null

  return (
    <>
      <button type="button" className={compact ? 'btn btn-accent btn-sm' : 'btn btn-accent'} onClick={() => setIsOpen(true)}>
        <span aria-hidden="true">+</span> Invite
      </button>
      {isOpen && (
        <InviteModal
          orgId={org.id}
          orgName={org.name}
          onClose={() => setIsOpen(false)}
          onInvited={() => onInvited?.()}
        />
      )}
    </>
  )
}
