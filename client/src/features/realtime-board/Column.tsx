import type { DragEvent } from 'react'
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
  function allowDrop(e: DragEvent) {
    if (e.dataTransfer.types.includes(CARD_DRAG_TYPE)) e.preventDefault()
  }

  function dropAt(e: DragEvent, beforeCardId: string | null) {
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
      onDragOver={allowDrop}
      onDrop={(e) => dropAt(e, null)}
      style={{ flex: '0 0 260px', border: '1px solid #ccc', borderRadius: 6, padding: 8, minHeight: 200 }}
    >
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>
        {column.name} ({cards.length})
      </h2>
      {cards.map((card) => (
        <div key={card.id} onDragOver={allowDrop} onDrop={(e) => dropAt(e, card.id)}>
          <Card card={card} onUpdate={onUpdate} onDelete={onDelete} />
        </div>
      ))}
      <CreateCardForm onCreate={(title) => onCreate(column.id, title)} />
    </section>
  )
}
