import { useEffect, useState } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { useAuth } from '../../context/AuthContext'

export function Dashboard() {
  const { logout } = useAuth()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    api
      .get('/auth/me')
      .then((res) => setEmail(res.data.user.email))
      .catch(() => setEmail(null))
  }, [])

  return (
    <div>
      <h1>Welcome</h1>
      <p>Logged in as: {email ?? 'loading...'}</p>
      <button onClick={() => logout()}>Log out</button>
    </div>
  )
}
