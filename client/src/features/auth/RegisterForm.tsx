import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../../context/AuthContext'
import { sanitizeRedirect } from '../../lib/sanitizeRedirect'

export function RegisterForm() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await register(email, password, name)
      navigate(sanitizeRedirect(searchParams.get('redirect')))
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError('An account with this email already exists')
      } else {
        setError('Registration failed, please check your details')
      }
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Register</h1>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Register</button>
      <p>
        Already have an account? <Link to={`/login${location.search}`}>Log in</Link>
      </p>
    </form>
  )
}
