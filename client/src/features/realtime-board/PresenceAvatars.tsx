import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { usePresence, type OrgMember } from '../../context/PresenceContext'
import { MemberAvatar } from '../../components/MemberAvatar'

const MAX_VISIBLE = 4

function displayName(member: OrgMember) {
  return member.name ?? member.email ?? 'Unknown member'
}

// You first, then everyone else alphabetically
function sortMembers(members: OrgMember[], myId: string | undefined) {
  return [...members].sort((a, b) =>
    a.userId === myId ? -1 : b.userId === myId ? 1 : displayName(a).localeCompare(displayName(b)),
  )
}

// Board page, top-right: a stack of who's viewing this board right now. Clicking it opens a
// lightweight popover listing every org member, split into online and offline.
export function PresenceAvatars() {
  const { onlineMembers, offlineMembers, isLoaded } = usePresence()
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on a click outside or Escape
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  if (!isLoaded) return null

  const online = sortMembers(onlineMembers, user?.id)
  const offline = sortMembers(offlineMembers, user?.id)
  const visible = online.slice(0, MAX_VISIBLE)
  const overflow = online.length - visible.length

  function renderRow(member: OrgMember, status: 'online' | 'offline') {
    return (
      <li key={member.userId} className="presence-row">
        <MemberAvatar userId={member.userId} name={member.name} email={member.email} size="sm" status={status} />
        <span className="presence-name">
          {displayName(member)}
          {member.userId === user?.id && <span className="faint"> (you)</span>}
        </span>
        <span className="presence-role mono">{member.role}</span>
      </li>
    )
  }

  return (
    <div className="presence" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="avatar-stack"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${online.length} viewing this board — show all members`}
        onClick={() => setIsOpen((open) => !open)}
      >
        {visible.map((m) => (
          <span key={m.userId} title={displayName(m)} className="avatar-stack-item">
            <MemberAvatar userId={m.userId} name={m.name} email={m.email} />
          </span>
        ))}
        {overflow > 0 && <span className="avatar-circle avatar-circle-md avatar-more avatar-stack-item">+{overflow}</span>}
      </button>

      {isOpen && (
        <div className="presence-popover" role="dialog" aria-label="Board members">
          <section aria-label="Online">
            <p className="presence-heading">
              <span className="dot dot-live" /> Online · {online.length}
            </p>
            <ul>{online.map((m) => renderRow(m, 'online'))}</ul>
          </section>
          <section aria-label="Offline">
            <p className="presence-heading">
              <span className="dot dot-off" /> Offline · {offline.length}
            </p>
            {offline.length === 0 ? (
              <p className="presence-empty">Everyone in the org is here.</p>
            ) : (
              <ul>{offline.map((m) => renderRow(m, 'offline'))}</ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
