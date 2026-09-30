import { useState, type FormEvent } from 'react'

// End-of-row "+ Add column" (Trello's placement): a button that turns into a small name form
export function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [isAdding, setIsAdding] = useState(false)
  const [name, setName] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setName('')
    setIsAdding(false)
  }

  if (!isAdding) {
    return (
      <button type="button" className="add-column-button" onClick={() => setIsAdding(true)}>
        + Add column
      </button>
    )
  }

  return (
    <form className="add-column-form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Column name</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          autoFocus
          placeholder="e.g. Review"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setIsAdding(false)}
        />
      </label>
      <div className="row" style={{ gap: 6 }}>
        <button type="submit" className="btn btn-ink btn-sm" disabled={!name.trim()}>
          Add column
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setIsAdding(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
