import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { CardData, ColumnData } from './boardState'
import { Card, CARD_DRAG_TYPE } from './Card'
import { CreateCardForm } from './CreateCardForm'

interface ColumnProps {
  column: ColumnData
  cards: CardData[]
  onCreate: (columnId: string, title: string) => void
  onMove: (cardId: string, toColumnId: string, toOrder: number) => void
  onOpen: (cardId: string) => void
  onDelete: (cardId: string) => void
}

// Plain HTML5 drag-and-drop: dropping on a card inserts before it, dropping on the
// column's empty space appends to the end
export function Column({ column, cards, onCreate, onMove, onOpen, onDelete }: ColumnProps) {
  const [isOver, setIsOver] = useState(false)
  const [overCardId, setOverCardId] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Long lists scroll inside the column; these drive the "more above/below" edge shadows
  const [edges, setEdges] = useState({ above: false, below: false })
  const scrollToNewCard = useRef(false)
  const previousCount = useRef(cards.length)

  useEffect(() => {
    const body = bodyRef.current
    const list = listRef.current
    if (!body || !list) return
    const update = () =>
      setEdges({
        above: body.scrollTop > 1,
        below: body.scrollTop + body.clientHeight < body.scrollHeight - 1,
      })
    update()
    body.addEventListener('scroll', update, { passive: true })
    // Content changes size too: cards added/removed, cover images finishing loading
    const observer = new ResizeObserver(update)
    observer.observe(list)
    observer.observe(body)
    return () => {
      body.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  // A card I just added lands at the bottom — bring it into view
  useEffect(() => {
    if (cards.length > previousCount.current && scrollToNewCard.current) {
      scrollToNewCard.current = false
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
    }
    previousCount.current = cards.length
  }, [cards.length])

  function allowDrop(e: DragEvent, beforeCardId: string | null) {
    if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    setIsOver(true)
    setOverCardId(beforeCardId)
  }

  function clearHighlight(e: DragEvent) {
    // dragleave also fires when moving onto a child element — only clear when truly leaving
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsOver(false)
    setOverCardId(null)
  }

  function dropAt(e: DragEvent, beforeCardId: string | null) {
    setIsOver(false)
    setOverCardId(null)
    const cardId = e.dataTransfer.getData(CARD_DRAG_TYPE)
    if (!cardId) return
    e.preventDefault()
    e.stopPropagation()

    // Index among the column's cards *excluding* the dragged one — same as the server's splice
    const others = cards.filter((c) => c.id !== cardId)
    const index = beforeCardId ? others.findIndex((c) => c.id === beforeCardId) : others.length
    if (index === -1) return
    onMove(cardId, column.id, index)
  }

  return (
    <section
      className={isOver ? 'board-column drop-active' : 'board-column'}
      onDragOver={(e) => allowDrop(e, null)}
      onDragLeave={clearHighlight}
      onDrop={(e) => dropAt(e, null)}
    >
      <header className="board-column-header">
        <h3>{column.name}</h3>
        <span className="pill">{cards.length}</span>
      </header>
      <div
        className={`board-column-scroll${edges.above ? ' more-above' : ''}${edges.below ? ' more-below' : ''}`}
      >
        {/* Scroll viewport: long lists scroll here instead of stretching the page */}
        <div className="board-column-body" ref={bodyRef}>
          {/* The list's content box: live cursors over cards are positioned relative to it, so
              they stay on the right card whatever each viewer's scroll position */}
          <div className="board-column-cards" ref={listRef} data-cursor-column={column.id}>
            {cards.map((card) => (
              <div key={card.id} onDragOver={(e) => allowDrop(e, card.id)} onDrop={(e) => dropAt(e, card.id)}>
                <Card card={card} dropBefore={overCardId === card.id} onOpen={onOpen} onDelete={onDelete} />
              </div>
            ))}
            {cards.length === 0 && (
              <p className="faint mono" style={{ fontSize: '0.75rem', padding: '12px 4px' }}>
                No cards yet
              </p>
            )}
          </div>
        </div>
      </div>
      <footer className="board-column-footer">
        <CreateCardForm
          onCreate={(title) => {
            scrollToNewCard.current = true
            onCreate(column.id, title)
          }}
        />
      </footer>
    </section>
  )
}
