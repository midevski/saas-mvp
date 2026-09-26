import { colorForUser } from '../lib/userColor'

// Initials on a colored background — the app's avatar style (no profile pictures in this project)

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
      style={{ background: colorForUser(userId) }}
      aria-hidden="true"
    >
      {initialsFor(name, email)}
      {status && <span className={`status-dot status-${status}`} />}
    </span>
  )
}
