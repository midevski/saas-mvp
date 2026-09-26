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
    <form onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New card"
        maxLength={200}
      />
      <button type="submit">Add</button>
    </form>
  )
}
