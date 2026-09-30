import { useState, type KeyboardEvent } from 'react'

interface InlineEditProps {
  value: string
  label: string
  maxLength: number
  className: string
  disabled?: boolean
  onSave: (value: string) => void
}

// Click the text to edit it in place: Enter or clicking away saves, Escape cancels
export function InlineEdit({ value, label, maxLength, className, disabled, onSave }: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const trimmed = draft.trim()
    setDraft(null)
    if (trimmed && trimmed !== value) onSave(trimmed)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault() // cancel just this edit, don't close the whole card
      setDraft(null)
    }
  }

  if (draft === null) {
    return (
      <button type="button" className={`inline-edit ${className}`} disabled={disabled} onClick={() => setDraft(value)}>
        {value}
      </button>
    )
  }

  return (
    <input
      className={`input inline-edit-input ${className}`}
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
