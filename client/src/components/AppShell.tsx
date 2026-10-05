import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'
import { ShellProvider, useShell } from '../context/ShellContext'
import { InviteButton } from '../features/dashboard/InviteButton'
import { Brand } from './Brand'
import { UserMenu } from './UserMenu'
import { NotificationBell } from './NotificationBell'
import { OrgDeletedNotice } from './OrgDeletedNotice'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')

export function AppShell() {
  // The navbar spot pages can render into (see ShellContext)
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)

  return (
    <ShellProvider headerSlot={headerSlot}>
      <AppHeader onSlotRef={setHeaderSlot} />
      <main className="container page">
        <OrgDeletedNotice />
        <Outlet />
      </main>
    </ShellProvider>
  )
}

function AppHeader({ onSlotRef }: { onSlotRef: (el: HTMLElement | null) => void }) {
  const { orgs, currentOrg, switchOrg } = useOrg()
  const { notifyInvited } = useShell()
  const location = useLocation()
  const navigate = useNavigate()

  // On org-scoped pages (board, billing) the org in the URL is the one being viewed
  const urlOrgId = location.pathname.match(/^\/orgs\/([^/]+)\//)?.[1]

  function changeOrg(orgId: string) {
    switchOrg(orgId)
    // Stay on the same section (board/billing) when switching orgs from an org-scoped page
    const match = location.pathname.match(/^\/orgs\/[^/]+\/(board|billing)$/)
    if (match) navigate(`/orgs/${orgId}/${match[1]}`)
  }

  return (
    <header className="app-header">
      <div className="container app-header-inner">
        <Link to="/" className="brand" aria-label="Dashboard">
          <Brand />
        </Link>

        <nav className="nav" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          {currentOrg && (
            <>
              <NavLink to={`/orgs/${currentOrg.id}/board`} className={navClass}>
                Board
              </NavLink>
              <NavLink to={`/orgs/${currentOrg.id}/billing`} className={navClass}>
                Billing
              </NavLink>
            </>
          )}
        </nav>

        <div className="header-right">
          {/* Filled by the board page with who's viewing it right now */}
          <div className="header-slot" ref={onSlotRef} />
          {orgs.length > 0 && (
            <select
              className="select select-sm"
              aria-label="Organization"
              value={currentOrg?.id ?? ''}
              onChange={(e) => changeOrg(e.target.value)}
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}
          {/* Owners/admins only (InviteButton hides itself otherwise) */}
          <InviteButton orgId={urlOrgId} onInvited={notifyInvited} compact />
          <span className="header-divider" />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
