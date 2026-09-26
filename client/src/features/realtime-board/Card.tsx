import { useState, type FormEvent } from 'react'
import type { CardData } from './boardState'

// Custom drag type so the column only accepts board cards, not arbitrary dragged text
export const CARD_DRAG_TYPE = 'application/x-board-card'

interface CardProps {
  card: CardData
  dropBefore: boolean
  onUpdate: (card: CardData, title: string, description: string | null) => void
  onDelete: (cardId: string) => void
}

export function Card({ card, dropBefore, onUpdate, onDelete }: CardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
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

  if (isEditing) {
    return (
      <form onSubmit={save} className="board-card board-card-edit">
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          autoFocus
          aria-label="Title"
        />
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          placeholder="Add a description..."
          aria-label="Description"
        />
        <div className="row" style={{ gap: 6 }}>
          <button type="submit" className="btn btn-ink btn-sm">
            Save
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setIsEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    )
  }

  const classes = ['board-card', isDragging && 'dragging', dropBefore && 'drop-before'].filter(Boolean).join(' ')

  return (
    <article
      className={classes}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
        e.dataTransfer.effectAllowed = 'move'
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      <p className="board-card-title">{card.title}</p>
      {card.description && <p className="board-card-desc">{card.description}</p>}
      <div className="board-card-actions">
        <button className="icon-btn" onClick={startEditing}>
          Edit
        </button>
        <button className="icon-btn icon-btn-danger" onClick={() => onDelete(card.id)}>
          Delete
        </button>
      </div>
    </article>
  )
}
