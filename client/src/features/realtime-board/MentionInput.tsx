import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { caretPosition } from '../../lib/caretPosition'
import { MemberAvatar } from '../../components/MemberAvatar'

export interface MentionCandidate {
  id: string
  name: string
}

// An '@' that's being typed right now: where it is and what follows it, up to the caret
interface Trigger {
  start: number // index of the '@'
  query: string
}

const MAX_SUGGESTIONS = 6
const MAX_QUERY = 40

// The '@…' just before the caret, if any. The '@' must start a word (so "me@example.com" doesn't
// trigger) and be followed by at least one character; the query may contain spaces ("@sam le")
// but not a line break.
function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null
  const query = before.slice(at + 1)
  if (query.length === 0 || query.length > MAX_QUERY || /[\n\r]/.test(query) || query.startsWith(' ')) return null
  return { start: at, query }
}

// Names starting with the query first, then names containing it
function suggestionsFor(query: string, candidates: MentionCandidate[]) {
  const q = query.toLowerCase()
  const starts: MentionCandidate[] = []
  const contains: MentionCandidate[] = []
  for (const c of candidates) {
    const name = c.name.toLowerCase()
    if (name.startsWith(q)) starts.push(c)
    else if (name.includes(q)) contains.push(c)
  }
  const byName = (a: MentionCandidate, b: MentionCandidate) => a.name.localeCompare(b.name)
  return [...starts.sort(byName), ...contains.sort(byName)].slice(0, MAX_SUGGESTIONS)
}

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  // People picked from the dropdown so far — the structured mention data sent with the comment.
  // Typing "@Someone" by hand never adds to it.
  mentions: MentionCandidate[]
  onMentionsChange: (mentions: MentionCandidate[]) => void
  candidates: MentionCandidate[]
  onSubmit: () => void
  placeholder?: string
  maxLength?: number
  label: string
}

// Instagram-style mentions: type '@' and a letter, pick a member from the dropdown that follows
// the caret (arrows + Enter, or click; Escape closes it). Picking inserts "@Name " and records
// their id. Enter otherwise submits; Shift+Enter adds a line.
export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  candidates,
  onSubmit,
  placeholder,
  maxLength,
  label,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listboxId = useId()
  const [caret, setCaret] = useState(0)
  const [highlighted, setHighlighted] = useState(0)
  // Escape closes the dropdown for that particular '@' until a new one is typed
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  // Where to put the caret after a pick (applied once React has rendered the new text)
  const pendingCaret = useRef<number | null>(null)

  const trigger = useMemo(() => {
    const t = findTrigger(value, caret)
    return t && t.start !== dismissedAt ? t : null
  }, [value, caret, dismissedAt])
  const suggestions = useMemo(() => (trigger ? suggestionsFor(trigger.query, candidates) : []), [trigger, candidates])
  const isOpen = suggestions.length > 0
  const active = Math.min(highlighted, suggestions.length - 1)

  // Keep the dropdown just below the '@' being typed
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea || !trigger) {
      setAnchor(null)
      return
    }
    const pos = caretPosition(textarea, trigger.start)
    const maxLeft = Math.max(0, textarea.clientWidth - 240)
    setAnchor({ top: pos.top + pos.lineHeight + 4, left: Math.min(Math.max(0, pos.left), maxLeft) })
  }, [trigger, value])

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !textareaRef.current) return
    textareaRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    setCaret(pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  function syncCaret() {
    const textarea = textareaRef.current
    if (textarea) setCaret(textarea.selectionStart)
  }

  function pick(person: MentionCandidate) {
    if (!trigger) return
    const inserted = `@${person.name} `
    const next = value.slice(0, trigger.start) + inserted + value.slice(caret)
    if (maxLength !== undefined && next.length > maxLength) return
    pendingCaret.current = trigger.start + inserted.length
    onChange(next)
    if (!mentions.some((m) => m.id === person.id)) onMentionsChange([...mentions, person])
    setHighlighted(0)
    textareaRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setHighlighted((active + step + suggestions.length) % suggestions.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        pick(suggestions[active]!)
        return
      }
      if (e.key === 'Escape') {
        // Close the dropdown only — not the card dialog around it
        e.preventDefault()
        e.stopPropagation()
        setDismissedAt(trigger!.start)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="mention-input">
      <textarea
        ref={textareaRef}
        className="textarea"
        aria-label={label}
        placeholder={placeholder}
        rows={2}
        maxLength={maxLength}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? `${listboxId}-${active}` : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          setHighlighted(0)
          // A new '@' (or deleting the dismissed one) re-enables the dropdown
          if (dismissedAt !== null && e.target.value[dismissedAt] !== '@') setDismissedAt(null)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
        // Clicking an option blurs nothing (see onMouseDown below); leaving the field closes it
        onBlur={() => trigger && setDismissedAt(trigger.start)}
        onFocus={() => setDismissedAt(null)}
      />
      {isOpen && anchor && (
        <ul
          id={listboxId}
          className="mention-suggestions"
          role="listbox"
          aria-label="Mention someone"
          style={{ top: anchor.top, left: anchor.left }}
        >
          {suggestions.map((person, i) => (
            <li
              key={person.id}
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              // mousedown, not click: keeps focus (and the caret) in the textarea
              onMouseDown={(e) => {
                e.preventDefault()
                pick(person)
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <MemberAvatar userId={person.id} name={person.name} email={null} size="sm" />
              <span>{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
