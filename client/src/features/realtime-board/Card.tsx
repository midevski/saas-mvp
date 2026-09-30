import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { checklistProgress, type CardData } from './boardState'

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

function ChecklistIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m8 12.5 2.8 2.8L16.5 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Whether a line-clamped element (see .board-card-title-text / .board-card-desc) is actually
// cutting text off. Re-measured when the text changes and whenever the element resizes (the
// card's width decides the wrapping).
function useIsTruncated<T extends HTMLElement>(text: string | null) {
  const ref = useRef<T>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Fires once on observe, then on every size change
    const observer = new ResizeObserver(() => setIsTruncated(el.scrollHeight > el.clientHeight + 1))
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return [ref, text !== null && isTruncated] as const
}

export function Card({ card, dropBefore, onOpen, onDelete }: CardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const cover = card.attachments[0]
  const checklist = checklistProgress(card.checklists)
  const classes = ['board-card', isDragging && 'dragging', dropBefore && 'drop-before'].filter(Boolean).join(' ')
  // Long titles and descriptions each stop at two lines ("…"); one "View more" appears if
  // either was actually cut off, and opens the card to read everything
  const [titleRef, titleTruncated] = useIsTruncated<HTMLSpanElement>(card.title)
  const [descRef, descTruncated] = useIsTruncated<HTMLParagraphElement>(card.description)

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
        // Full title on hover when it's cut off
        title={titleTruncated ? card.title : undefined}
        onClick={(e) => {
          stop(e)
          onOpen(card.id)
        }}
      >
        {/* The clamp lives on an inner span: line-clamp is unreliable on buttons themselves */}
        <span ref={titleRef} className="board-card-title-text">
          {card.title}
        </span>
      </button>
      {card.description && (
        <p ref={descRef} className="board-card-desc">
          {card.description}
        </p>
      )}
      {(titleTruncated || descTruncated) && (
        <button
          type="button"
          className="board-card-more"
          onClick={(e) => {
            stop(e)
            onOpen(card.id)
          }}
        >
          View more
        </button>
      )}
      <div className="board-card-footer">
        {checklist.total > 0 && (
          <span
            className={`board-card-badge${checklist.done === checklist.total ? ' is-complete' : ''}`}
            title="Checklist progress"
            aria-label={`Checklist: ${checklist.done} of ${checklist.total} done`}
          >
            <ChecklistIcon />
            {checklist.done}/{checklist.total}
          </span>
        )}
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
