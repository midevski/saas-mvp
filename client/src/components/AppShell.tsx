import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { Brand } from './Brand'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'nav-link active' : 'nav-link')

export function AppShell() {
  const { user, logout } = useAuth()
  const { orgs, currentOrg, switchOrg } = useOrg()
  const location = useLocation()
  const navigate = useNavigate()

  function changeOrg(orgId: string) {
    switchOrg(orgId)
    // Stay on the same section (board/billing) when switching orgs from an org-scoped page
    const match = location.pathname.match(/^\/orgs\/[^/]+\/(board|billing)$/)
    if (match) navigate(`/orgs/${orgId}/${match[1]}`)
  }

  return (
    <>
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
            {orgs.length > 0 && (
              <>
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
                <span className="header-divider" />
              </>
            )}
            <span className="user-email">{user?.email}</span>
            <button className="btn btn-outline btn-sm" onClick={() => logout()}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="container page">
        <Outlet />
      </main>
    </>
  )
}
