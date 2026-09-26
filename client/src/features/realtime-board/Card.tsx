import { useState, type MouseEvent } from 'react'
import type { CardData } from './boardState'

// Custom drag type so the column only accepts board cards, not arbitrary dragged text
export const CARD_DRAG_TYPE = 'application/x-board-card'

interface CardProps {
  card: CardData
  dropBefore: boolean
  onOpen: (cardId: string) => void
  onDelete: (cardId: string) => void
}

function PaperclipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path
        d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.6-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Card({ card, dropBefore, onOpen, onDelete }: CardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const cover = card.attachments[0]
  const classes = ['board-card', isDragging && 'dragging', dropBefore && 'drop-before'].filter(Boolean).join(' ')

  // Buttons on the card do their own thing instead of also opening it
  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <article
      className={classes}
      draggable
      onClick={() => onOpen(card.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
        e.dataTransfer.effectAllowed = 'move'
        setIsDragging(true)
      }}
      onDragEnd={() => setIsDragging(false)}
    >
      {/* First image as a cover, so attachments are visible without opening the card */}
      {cover && <img className="board-card-cover" src={cover.url} alt="" loading="lazy" draggable={false} />}
      <button
        type="button"
        className="board-card-title"
        onClick={(e) => {
          stop(e)
          onOpen(card.id)
        }}
      >
        {card.title}
      </button>
      {card.description && <p className="board-card-desc">{card.description}</p>}
      <div className="board-card-footer">
        {card.attachments.length > 0 && (
          <span
            className="board-card-badge"
            title={`${card.attachments.length} image${card.attachments.length === 1 ? '' : 's'}`}
            aria-label={`${card.attachments.length} image${card.attachments.length === 1 ? '' : 's'}`}
          >
            <PaperclipIcon />
            {card.attachments.length}
          </span>
        )}
        <div className="board-card-actions">
          <button
            className="icon-btn"
            onClick={(e) => {
              stop(e)
              onOpen(card.id)
            }}
          >
            Edit
          </button>
          <button
            className="icon-btn icon-btn-danger"
            onClick={(e) => {
              stop(e)
              onDelete(card.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}
