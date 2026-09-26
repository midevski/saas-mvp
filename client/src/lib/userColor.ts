// A person's color everywhere (avatar, live cursor): derived from their userId, so it's the
// same across sessions and devices rather than random per connection.

// Picked to sit well on the paper background and keep white text readable
const PALETTE = ['#ff4d2e', '#0f1115', '#2f6f5e', '#3a5a9b', '#8a5a1f', '#6a4c93', '#b83b5e']

export function colorForUser(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}
