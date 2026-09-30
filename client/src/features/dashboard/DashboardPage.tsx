import { useAuth } from '../../context/AuthContext'
import { useOrg } from '../../context/OrgContext'
import { PageHeader } from '../../components/PageHeader'
import { CreateOrgForm } from './CreateOrgForm'
import { MembersList } from './MembersList'
import { PendingInvites } from './PendingInvites'
import { GatedFeatureLink } from '../billing/GatedFeatureLink'
import { DeleteOrgCard } from './DeleteOrgCard'

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
        <div className="stack" style={{ gap: 24 }}>
          <MembersList />
          <PendingInvites />
        </div>
        <div className="stack" style={{ gap: 24 }}>
          <GatedFeatureLink />
          <CreateOrgForm />
          {/* Owners only; renders nothing for admins and members */}
          <DeleteOrgCard key={currentOrg.id} org={currentOrg} />
        </div>
      </div>
    </>
  )
}
