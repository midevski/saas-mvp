import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { CenterState } from '../../components/CenterState'

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <CenterState>
        <p className="eyebrow">Loading...</p>
      </CenterState>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  return <Outlet />
}
