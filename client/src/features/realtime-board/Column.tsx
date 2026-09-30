import { useEffect, useRef, useState, type DragEvent } from 'react'
import { InlineEdit } from '../../components/InlineEdit'
import type { CardData, ColumnData } from './boardState'
import { Card, CARD_DRAG_TYPE } from './Card'
import { CreateCardForm } from './CreateCardForm'

// Columns drag with their own type, so a column drop and a card drop can never be confused
export const COLUMN_DRAG_TYPE = 'application/x-board-column'

export type DropSide = 'before' | 'after'

interface ColumnProps {
  column: ColumnData
  cards: CardData[]
  isFirst: boolean
  isLast: boolean
  // This browser only (localStorage) — never sent anywhere
  collapsed: boolean
  onToggleCollapse: () => void
  onRename: (name: string) => void
  onRequestDelete: () => void
  onColumnDrop: (draggedColumnId: string, side: DropSide) => void
  onShift: (delta: -1 | 1) => void // keyboard-friendly reorder from the menu
  onCreate: (columnId: string, title: string) => void
  onMove: (cardId: string, toColumnId: string, toOrder: number) => void
  onOpen: (cardId: string) => void
  onDelete: (cardId: string) => void
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DragHandle({ label, onDragStart }: { label: string; onDragStart: (e: DragEvent<HTMLSpanElement>) => void }) {
  return (
    <span className="column-drag-handle" draggable title={label} aria-hidden="true" onDragStart={onDragStart}>
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
        {[2, 8, 14].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.5" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.5" />])}
      </svg>
    </span>
  )
}

// Small "…" menu in the column header
function ColumnMenu({
  columnName,
  isFirst,
  isLast,
  onShift,
  onDelete,
}: {
  columnName: string
  isFirst: boolean
  isLast: boolean
  onShift: (delta: -1 | 1) => void
  onDelete: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const run = (action: () => void) => () => {
    setIsOpen(false)
    action()
  }

  return (
    <div className="column-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="column-icon-btn"
        aria-label={`${columnName} column options`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        ⋯
      </button>
      {isOpen && (
        <div className="column-menu-popover" role="menu" aria-label={`${columnName} column`}>
          <button type="button" role="menuitem" className="user-menu-item" disabled={isFirst} onClick={run(() => onShift(-1))}>
            Move left
          </button>
          <button type="button" role="menuitem" className="user-menu-item" disabled={isLast} onClick={run(() => onShift(1))}>
            Move right
          </button>
          <button type="button" role="menuitem" className="user-menu-item is-danger" onClick={run(onDelete)}>
            Delete column
          </button>
        </div>
      )}
    </div>
  )
}

// Plain HTML5 drag-and-drop: dropping a card on a card inserts before it, on the column's empty
// space appends to the end. Dropping a *column* on a column puts it on the nearer side.
export function Column(props: ColumnProps) {
  const { column, cards, collapsed, onToggleCollapse, onColumnDrop, onCreate, onMove, onOpen, onDelete } = props
  const [isOver, setIsOver] = useState(false)
  const [overCardId, setOverCardId] = useState<string | null>(null)
  const [columnDropSide, setColumnDropSide] = useState<DropSide | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Long lists scroll inside the column; these drive the "more above/below" edge shadows
  const [edges, setEdges] = useState({ above: false, below: false })
  const scrollToNewCard = useRef(false)
  const previousCount = useRef(cards.length)

  // Re-attached when the column expands again (a collapsed column has no list to watch)
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
  }, [collapsed])

  // A card I just added lands at the bottom — bring it into view
  useEffect(() => {
    if (cards.length > previousCount.current && scrollToNewCard.current) {
      scrollToNewCard.current = false
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
    }
    previousCount.current = cards.length
  }, [cards.length])

  function allowDrop(e: DragEvent, beforeCardId: string | null) {
    const types = e.dataTransfer.types
    if (types.includes(CARD_DRAG_TYPE)) {
      e.preventDefault()
      e.stopPropagation()
      setIsOver(true)
      setOverCardId(beforeCardId)
    } else if (types.includes(COLUMN_DRAG_TYPE)) {
      // Column drags are handled at the column level (the inner card targets let them through)
      e.preventDefault()
      const rect = sectionRef.current!.getBoundingClientRect()
      setColumnDropSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
    }
  }

  function clearHighlight(e: DragEvent) {
    // dragleave also fires when moving onto a child element — only clear when truly leaving
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsOver(false)
    setOverCardId(null)
    setColumnDropSide(null)
  }

  function dropAt(e: DragEvent, beforeCardId: string | null) {
    const side = columnDropSide
    setIsOver(false)
    setOverCardId(null)
    setColumnDropSide(null)

    const draggedColumnId = e.dataTransfer.getData(COLUMN_DRAG_TYPE)
    if (draggedColumnId) {
      e.preventDefault()
      // Handled once: a drop on one of this column's cards shouldn't bubble to the column too
      e.stopPropagation()
      if (draggedColumnId !== column.id && side) onColumnDrop(draggedColumnId, side)
      return
    }

    const cardId = e.dataTransfer.getData(CARD_DRAG_TYPE)
    if (!cardId) return
    e.preventDefault()
    e.stopPropagation()
    // Index among the column's cards *excluding* the dragged one — same as the server's splice.
    // (A collapsed column shows no cards, so a drop there always appends.)
    const others = cards.filter((c) => c.id !== cardId)
    const index = beforeCardId ? others.findIndex((c) => c.id === beforeCardId) : others.length
    if (index === -1) return
    onMove(cardId, column.id, index)
  }

  function startColumnDrag(e: DragEvent) {
    e.stopPropagation()
    e.dataTransfer.setData(COLUMN_DRAG_TYPE, column.id)
    e.dataTransfer.effectAllowed = 'move'
    // Drag the whole column's image, not just the little grip
    if (sectionRef.current) e.dataTransfer.setDragImage(sectionRef.current, 24, 20)
  }

  const classes = [
    'board-column',
    collapsed && 'is-collapsed',
    isOver && 'drop-active',
    columnDropSide && `column-drop-${columnDropSide}`,
  ]
    .filter(Boolean)
    .join(' ')
  const dropHandlers = {
    onDragOver: (e: DragEvent) => allowDrop(e, null),
    onDragLeave: clearHighlight,
    onDrop: (e: DragEvent) => dropAt(e, null),
  }

  if (collapsed) {
    // A slim strip: title + count. Still a drop target (cards append to the bottom), still
    // draggable, and clicking anywhere on it expands it again.
    return (
      <section
        ref={sectionRef}
        className={classes}
        {...dropHandlers}
        onClick={onToggleCollapse}
        aria-label={column.name}
        data-cursor-column-frame={column.id}
      >
        <DragHandle label="Drag to reorder" onDragStart={startColumnDrag} />
        <button
          type="button"
          className="column-icon-btn"
          aria-label={`Expand ${column.name}`}
          aria-expanded={false}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
        >
          <Chevron direction="right" />
        </button>
        <span className="pill">{cards.length}</span>
        <h3 className="collapsed-title">{column.name}</h3>
      </section>
    )
  }

  return (
    <section ref={sectionRef} className={classes} {...dropHandlers} data-cursor-column-frame={column.id}>
      <header className="board-column-header">
        <DragHandle label="Drag to reorder" onDragStart={startColumnDrag} />
        <h3 className="column-heading">
          <InlineEdit value={column.name} label="Column name" maxLength={60} className="column-name" onSave={props.onRename} />
        </h3>
        <span className="pill">{cards.length}</span>
        <button
          type="button"
          className="column-icon-btn"
          aria-label={`Collapse ${column.name}`}
          aria-expanded={true}
          onClick={onToggleCollapse}
        >
          <Chevron direction="left" />
        </button>
        <ColumnMenu
          columnName={column.name}
          isFirst={props.isFirst}
          isLast={props.isLast}
          onShift={props.onShift}
          onDelete={props.onRequestDelete}
        />
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
