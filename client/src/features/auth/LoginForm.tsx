import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { sanitizeRedirect } from '../../lib/sanitizeRedirect'

export function LoginForm() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await login(email, password)
      navigate(sanitizeRedirect(searchParams.get('redirect')))
    } catch {
      setError('Invalid email or password')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
      <p>
        No account? <Link to={`/register${location.search}`}>Register</Link>
      </p>
    </form>
  )
}
