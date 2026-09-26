import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { sanitizeRedirect } from '../../lib/sanitizeRedirect'
import { AuthLayout } from './AuthLayout'

export function LoginForm() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
      navigate(sanitizeRedirect(searchParams.get('redirect')))
    } catch {
      setError('Invalid email or password')
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <p className="eyebrow">
            <span className="dot" />
            Welcome back
          </p>
          <h1>Log in</h1>
          <p className="muted">Sign in to your workspace.</p>
        </div>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-accent btn-block" disabled={busy}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
        <p className="muted" style={{ fontSize: '0.875rem' }}>
          No account?{' '}
          <Link to={`/register${location.search}`} className="link-underline" style={{ color: 'var(--color-fg)' }}>
            Create one
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
