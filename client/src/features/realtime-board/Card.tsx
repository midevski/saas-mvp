import { useState, type FormEvent } from 'react'
import type { CardData } from './boardState'

// Custom drag type so the column only accepts board cards, not arbitrary dragged text
export const CARD_DRAG_TYPE = 'application/x-board-card'

interface CardProps {
  card: CardData
  onUpdate: (card: CardData, title: string, description: string | null) => void
  onDelete: (cardId: string) => void
}

export function Card({ card, onUpdate, onDelete }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')

  function startEditing() {
    setTitle(card.title)
    setDescription(card.description ?? '')
    setIsEditing(true)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onUpdate(card, trimmed, description.trim() || null)
    setIsEditing(false)
  }

  const style = { border: '1px solid #ddd', borderRadius: 4, padding: 8, marginBottom: 8, background: 'var(--bg)' }

  if (isEditing) {
    return (
      <form onSubmit={save} style={style}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          placeholder="Description"
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => setIsEditing(false)}>
          Cancel
        </button>
      </form>
    )
  }

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      style={{ ...style, cursor: 'grab' }}
    >
      <strong>{card.title}</strong>
      {card.description && <p style={{ margin: '4px 0' }}>{card.description}</p>}
      <div>
        <button onClick={startEditing}>Edit</button>
        <button onClick={() => onDelete(card.id)}>Delete</button>
      </div>
    </article>
  )
}
