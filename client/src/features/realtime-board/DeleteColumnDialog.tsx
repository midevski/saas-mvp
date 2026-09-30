import { useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { ColumnData } from './boardState'

interface DeleteColumnDialogProps {
  column: ColumnData
  cardCount: number
  otherColumns: ColumnData[]
  // moveCardsTo: destination column for the cards; undefined = delete the cards too
  onConfirm: (moveCardsTo?: string) => void
  onCancel: () => void
}

// Empty column: a plain confirm. With cards: an explicit choice between moving them to another
// column or deleting them too — never a vague "are you sure".
export function DeleteColumnDialog({ column, cardCount, otherColumns, onConfirm, onCancel }: DeleteColumnDialogProps) {
  const canMove = otherColumns.length > 0
  const [choice, setChoice] = useState<'move' | 'delete'>(canMove ? 'move' : 'delete')
  const [destination, setDestination] = useState(otherColumns[0]?.id ?? '')
  const cards = `${cardCount} card${cardCount === 1 ? '' : 's'}`

  if (cardCount === 0) {
    return (
      <ConfirmDialog
        title={`Delete "${column.name}"?`}
        confirmLabel="Delete column"
        onConfirm={() => onConfirm()}
        onCancel={onCancel}
      >
        <p>This column is empty. It will be removed from the board for everyone.</p>
      </ConfirmDialog>
    )
  }

  return (
    <ConfirmDialog
      title={`Delete "${column.name}"?`}
      confirmLabel={choice === 'move' ? 'Move cards & delete column' : `Delete column & ${cards}`}
      confirmDisabled={choice === 'move' && !destination}
      onConfirm={() => onConfirm(choice === 'move' ? destination : undefined)}
      onCancel={onCancel}
    >
      <p>
        This column has <strong>{cards}</strong>. What should happen to {cardCount === 1 ? 'it' : 'them'}?
      </p>
      <fieldset className="stack" style={{ gap: 8, border: 0, margin: 0, padding: 0 }}>
        <legend className="sr-only">What to do with the cards</legend>
        {canMove && (
          <label className="role-option">
            <input type="radio" name="column-cards" checked={choice === 'move'} onChange={() => setChoice('move')} />
            <span style={{ flex: 1 }}>
              <span className="role-option-title">Move cards to another column</span>
              <select
                className="select"
                style={{ marginTop: 8 }}
                aria-label="Destination column"
                value={destination}
                disabled={choice !== 'move'}
                onChange={(e) => setDestination(e.target.value)}
              >
                {otherColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}
        <label className="role-option">
          <input type="radio" name="column-cards" checked={choice === 'delete'} onChange={() => setChoice('delete')} />
          <span>
            <span className="role-option-title">Delete cards too</span>
            <span className="role-option-desc">
              The {cards} (with their images and checklists) are deleted for everyone. This can't be undone.
            </span>
          </span>
        </label>
      </fieldset>
    </ConfirmDialog>
  )
}
