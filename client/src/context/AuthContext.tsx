import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setAccessToken, setOnAuthFailure } from '../lib/api/axiosInstance'

interface AuthUser {
  id: string
  email: string
  name: string
}

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const clearSession = useCallback(() => {
    setAccessToken(null)
    setUser(null)
  }, [])

  // Silent refresh on load: restores a session from the httpOnly cookie
  useEffect(() => {
    setOnAuthFailure(clearSession)

    api
      .post('/auth/refresh')
      .then((res) => {
        setAccessToken(res.data.accessToken)
        setUser(res.data.user)
      })
      .catch(() => clearSession())
      .finally(() => setIsLoading(false))

    return () => setOnAuthFailure(null)
  }, [clearSession])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password })
    setAccessToken(res.data.accessToken)
    setUser(res.data.user)
  }, [])

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await api.post('/auth/register', { email, password, name })
    setAccessToken(res.data.accessToken)
    setUser(res.data.user)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    clearSession()
  }, [clearSession])

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
