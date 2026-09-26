import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LoginForm } from './features/auth/LoginForm'
import { RegisterForm } from './features/auth/RegisterForm'
import { ProtectedRoute } from './features/auth/ProtectedRoute'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { AcceptInvitePage } from './features/dashboard/AcceptInvitePage'
import { BillingPage } from './features/billing/BillingPage'
import { BoardPage } from './features/realtime-board/BoardPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/register" element={<RegisterForm />} />
      <Route path="/invites/:token" element={<AcceptInvitePage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orgs/:orgId/billing" element={<BillingPage />} />
          <Route path="/orgs/:orgId/board" element={<BoardPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
