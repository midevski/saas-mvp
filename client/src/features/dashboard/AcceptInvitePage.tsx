import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api/axiosInstance'
import { useAuth } from '../../context/AuthContext'
import { useOrg } from '../../context/OrgContext'

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const { user, isLoading } = useAuth()
  const { refreshOrgs, switchOrg } = useOrg()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isLoading || !user || !token) return

    api
      .post(`/invites/${token}/accept`)
      .then(async (res) => {
        await refreshOrgs()
        switchOrg(res.data.orgId)
        navigate('/')
      })
      .catch(() => setError('This invite is invalid or has expired'))
  }, [isLoading, user, token, refreshOrgs, switchOrg, navigate])

  if (isLoading) return <p>Loading...</p>
  if (!user) return <Navigate to={`/login?redirect=/invites/${token}`} replace />
  if (error) return <p role="alert">{error}</p>

  return <p>Accepting invite...</p>
}
