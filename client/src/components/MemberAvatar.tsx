// Initials on a colored background — the app's avatar style (no profile pictures in this project)

// Picked to sit well on the paper background and keep white initials readable
const PALETTE = ['#ff4d2e', '#0f1115', '#2f6f5e', '#3a5a9b', '#8a5a1f', '#6a4c93', '#b83b5e']

function colorFor(id: string) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

function initialsFor(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split('@')[0] || '?'
  const words = source.split(/\s+/).filter(Boolean)
  const initials = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : source.slice(0, 2)
  return initials.toUpperCase()
}

interface MemberAvatarProps {
  userId: string
  name: string | null
  email: string | null
  size?: 'md' | 'sm'
  status?: 'online' | 'offline'
}

export function MemberAvatar({ userId, name, email, size = 'md', status }: MemberAvatarProps) {
  return (
    <span
      className={`avatar-circle avatar-circle-${size}${status === 'offline' ? ' is-offline' : ''}`}
      style={{ background: colorFor(userId) }}
      aria-hidden="true"
    >
      {initialsFor(name, email)}
      {status && <span className={`status-dot status-${status}`} />}
    </span>
  )
}
