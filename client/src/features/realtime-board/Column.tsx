import { useState, type DragEvent } from 'react'
import type { CardData, ColumnData } from './boardState'
import { Card, CARD_DRAG_TYPE } from './Card'
import { CreateCardForm } from './CreateCardForm'

interface ColumnProps {
  column: ColumnData
  cards: CardData[]
  onCreate: (columnId: string, title: string) => void
  onMove: (cardId: string, toColumnId: string, toOrder: number) => void
  onUpdate: (card: CardData, title: string, description: string | null) => void
  onDelete: (cardId: string) => void
}

// Plain HTML5 drag-and-drop: dropping on a card inserts before it, dropping on the
// column's empty space appends to the end
export function Column({ column, cards, onCreate, onMove, onUpdate, onDelete }: ColumnProps) {
  const [isOver, setIsOver] = useState(false)
  const [overCardId, setOverCardId] = useState<string | null>(null)

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
      <div className="board-column-body">
        {cards.map((card) => (
          <div key={card.id} onDragOver={(e) => allowDrop(e, card.id)} onDrop={(e) => dropAt(e, card.id)}>
            <Card card={card} dropBefore={overCardId === card.id} onUpdate={onUpdate} onDelete={onDelete} />
          </div>
        ))}
        {cards.length === 0 && (
          <p className="faint mono" style={{ fontSize: '0.75rem', padding: '12px 4px' }}>
            No cards yet
          </p>
        )}
      </div>
      <footer className="board-column-footer">
        <CreateCardForm onCreate={(title) => onCreate(column.id, title)} />
      </footer>
    </section>
  )
}
