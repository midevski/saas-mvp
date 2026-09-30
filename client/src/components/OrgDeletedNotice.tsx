import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrg } from '../context/OrgContext'
import { useSocket } from '../context/SocketContext'
import { ORG_DELETED } from '../lib/socketEvents'

interface OrgDeletedPayload {
  orgId: string
  orgName: string
}

// App-wide: when an org you belong to is deleted (by its owner, in this tab or anywhere else),
// drop it from the org switcher, leave any of its pages you're on, and say what happened.
export function OrgDeletedNotice() {
  const { socket } = useSocket()
  const { refreshOrgs } = useOrg()
  const navigate = useNavigate()
  const [deletedNames, setDeletedNames] = useState<string[]>([])

  useEffect(() => {
    const onDeleted = ({ orgId, orgName }: OrgDeletedPayload) => {
      setDeletedNames((names) => [...names, orgName])
      void refreshOrgs()
      if (window.location.pathname.startsWith(`/orgs/${orgId}/`)) navigate('/', { replace: true })
    }
    socket.on(ORG_DELETED, onDeleted)
    return () => {
      socket.off(ORG_DELETED, onDeleted)
    }
  }, [socket, refreshOrgs, navigate])

  if (deletedNames.length === 0) return null

  const names = deletedNames.map((name) => `"${name}"`).join(', ')
  return (
    <div className="notice notice-dismissible" role="status">
      <span>
        {names} {deletedNames.length === 1 ? 'was' : 'were'} deleted and {deletedNames.length === 1 ? 'is' : 'are'} no
        longer available.
      </span>
      <button type="button" className="modal-close" aria-label="Dismiss" onClick={() => setDeletedNames([])}>
        ×
      </button>
    </div>
  )
}
