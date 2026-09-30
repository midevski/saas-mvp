import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import { sanitizeRedirect } from '../../lib/sanitizeRedirect'
import { AuthLayout } from './AuthLayout'
import { PasswordInput } from '../../components/PasswordInput'

export function RegisterForm() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(email, password, name)
      navigate(sanitizeRedirect(searchParams.get('redirect')))
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError('An account with this email already exists')
      } else {
        setError('Registration failed, please check your details')
      }
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <p className="eyebrow">
            <span className="dot" />
            Get started
          </p>
          <h1>Create your account</h1>
          <p className="muted">It takes less than a minute.</p>
        </div>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-accent btn-block" disabled={busy}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
        <p className="muted" style={{ fontSize: '0.875rem' }}>
          Already have an account?{' '}
          <Link to={`/login${location.search}`} className="link-underline" style={{ color: 'var(--color-fg)' }}>
            Log in
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
