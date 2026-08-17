import { Route, Routes } from 'react-router-dom'
import { LoginForm } from './features/auth/LoginForm'
import { RegisterForm } from './features/auth/RegisterForm'
import { ProtectedRoute } from './features/auth/ProtectedRoute'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { AcceptInvitePage } from './features/dashboard/AcceptInvitePage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginForm />} />
      <Route path="/register" element={<RegisterForm />} />
      <Route path="/invites/:token" element={<AcceptInvitePage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
      </Route>
    </Routes>
  )
}

export default App
