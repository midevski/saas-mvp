import { useState, type FormEvent } from 'react'

export function CreateCardForm({ onCreate }: { onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onCreate(trimmed)
    setTitle('')
  }

  return (
    <form onSubmit={submit} className="add-card">
      <input
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a card..."
        aria-label="New card title"
        maxLength={200}
      />
      <button type="submit" className="btn btn-ink btn-sm" disabled={!title.trim()}>
        Add
      </button>
    </form>
  )
}
