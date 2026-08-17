import { useOrg } from '../../context/OrgContext'

export function OrgSwitcher() {
  const { orgs, currentOrg, switchOrg } = useOrg()

  if (orgs.length === 0) return null

  return (
    <label>
      Organization
      <select value={currentOrg?.id ?? ''} onChange={(e) => switchOrg(e.target.value)}>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} ({org.role})
          </option>
        ))}
      </select>
    </label>
  )
}
