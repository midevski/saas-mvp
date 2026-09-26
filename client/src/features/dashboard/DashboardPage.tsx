import { useAuth } from '../../context/AuthContext'
import { useOrg } from '../../context/OrgContext'
import { PageHeader } from '../../components/PageHeader'
import { CreateOrgForm } from './CreateOrgForm'
import { InviteForm } from './InviteForm'
import { MembersList } from './MembersList'
import { GatedFeatureLink } from '../billing/GatedFeatureLink'

export function DashboardPage() {
  const { user } = useAuth()
  const { currentOrg, currentRole, isLoading } = useOrg()

  if (isLoading) return <p className="eyebrow">Loading...</p>

  if (!currentOrg) {
    return (
      <>
        <PageHeader
          eyebrow="Get started"
          title={`Welcome, ${user?.name ?? 'there'}`}
          lede="Create your first organization to invite teammates and start using the board."
        />
        <div style={{ maxWidth: '32rem' }}>
          <CreateOrgForm />
        </div>
      </>
    )
  }

  const canInvite = currentRole === 'owner' || currentRole === 'admin'

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={currentOrg.name}
        lede={
          <>
            Signed in as {user?.name} · <span className="pill">{currentRole}</span>
          </>
        }
      />
      <div className="grid-2">
        <MembersList />
        <div className="stack" style={{ gap: 24 }}>
          <GatedFeatureLink />
          {canInvite && <InviteForm />}
          <CreateOrgForm />
        </div>
      </div>
    </>
  )
}
