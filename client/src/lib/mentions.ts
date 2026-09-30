const WORD_CHAR = /[\p{L}\p{N}_]/u

export interface MentionRange {
  id: string
  start: number
  end: number
}

// Finds where `@Name` for each of the given people appears in the text. It never decides *who*
// is mentioned — that's only ever the people explicitly picked in the mention dropdown (and, for
// a posted comment, the ids the server stored). It's used to locate those picks: to highlight
// them in a posted comment, and to drop a pick whose "@Name" was deleted before posting.
// Whole names only, case-insensitive; an '@' must start a word; the longest name wins.
export function findMentions(text: string, people: { id: string; name: string }[]): MentionRange[] {
  const candidates = people
    .map((p) => ({ id: p.id, name: p.name.trim() }))
    .filter((p) => p.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  const found: MentionRange[] = []
  let at = text.indexOf('@')
  while (at !== -1) {
    let next = at + 1
    if (at === 0 || !WORD_CHAR.test(text[at - 1]!)) {
      const match = candidates.find((c) => {
        const end = at + 1 + c.name.length
        return (
          text.slice(at + 1, end).toLowerCase() === c.name.toLowerCase() && !WORD_CHAR.test(text[end] ?? '')
        )
      })
      if (match) {
        next = at + 1 + match.name.length
        found.push({ id: match.id, start: at, end: next })
      }
    }
    at = text.indexOf('@', next)
  }
  return found
}

// The text cut into plain and mention pieces, in order
export function splitMentions(text: string, people: { id: string; name: string }[]) {
  const parts: ({ kind: 'text'; text: string } | { kind: 'mention'; text: string; id: string })[] = []
  let cursor = 0
  for (const m of findMentions(text, people)) {
    if (m.start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, m.start) })
    parts.push({ kind: 'mention', text: text.slice(m.start, m.end), id: m.id })
    cursor = m.end
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}
