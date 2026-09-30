import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { MemberAvatar } from './MemberAvatar'

// Navbar account menu: your avatar (initials — the app has no profile photos), opening a small
// menu with who you're signed in as and Log out
export function UserMenu() {
  const { user, logout } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  // Close on a click outside or Escape; focus the first item when it opens
  useEffect(() => {
    if (!isOpen) return
    firstItemRef.current?.focus()
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

  if (!user) return null

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="user-menu-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <MemberAvatar userId={user.id} name={user.name} email={user.email} />
      </button>

      {isOpen && (
        <div className="user-menu-popover" role="menu" aria-label="Account">
          <div className="user-menu-identity">
            <MemberAvatar userId={user.id} name={user.name} email={user.email} />
            <div style={{ minWidth: 0 }}>
              <div className="user-menu-name">{user.name}</div>
              <div className="user-menu-email">{user.email}</div>
            </div>
          </div>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setIsOpen(false)
              void logout()
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
