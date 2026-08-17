import { Dashboard } from '../auth/Dashboard'
import { useOrg } from '../../context/OrgContext'
import { OrgSwitcher } from './OrgSwitcher'
import { CreateOrgForm } from './CreateOrgForm'
import { InviteForm } from './InviteForm'
import { MembersList } from './MembersList'
import { GatedFeatureLink } from '../billing/GatedFeatureLink'

export function DashboardPage() {
  const { currentOrg } = useOrg()

  return (
    <div>
      <Dashboard />
      <hr />
      <OrgSwitcher />
      <CreateOrgForm />
      {currentOrg && (
        <>
          <InviteForm />
          <MembersList />
          <GatedFeatureLink />
        </>
      )}
    </div>
  )
}
