import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api } from '../../lib/api/axiosInstance'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { checklistProgress, type CardData, type ChecklistData, type ChecklistItemData } from './boardState'

interface ChecklistSectionProps {
  orgId: string
  card: CardData // live from board state
  onCardChanged: (card: CardData) => void
  // Pull an authoritative snapshot after a failed change, instead of trying to undo by hand
  onResync: () => void
}

// Items/checklists created optimistically carry a temporary id until the server responds
const tempId = () => `tmp-${Math.random().toString(36).slice(2)}`
const isTemp = (id: string) => id.startsWith('tmp-')

function mapChecklist(card: CardData, checklistId: string, fn: (c: ChecklistData) => ChecklistData): CardData {
  return { ...card, checklists: card.checklists.map((c) => (c.id === checklistId ? fn(c) : c)) }
}

function mapItem(
  card: CardData,
  checklistId: string,
  itemId: string,
  fn: (i: ChecklistItemData) => ChecklistItemData,
): CardData {
  return mapChecklist(card, checklistId, (c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? fn(i) : i)) }))
}

export function ChecklistSection({ orgId, card, onCardChanged, onResync }: ChecklistSectionProps) {
  const [error, setError] = useState<string | null>(null)
  const [addingChecklist, setAddingChecklist] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ChecklistData | null>(null)
  // Optimistic updates: responses are only applied once the last in-flight request settles,
  // so an older response can't briefly undo a newer optimistic change
  const inFlight = useRef(0)
  const base = `/orgs/${orgId}/board/cards/${card.id}/checklists`

  function mutate(
    optimistic: CardData,
    request: () => Promise<{ data: { card: CardData } }>,
    failure: string,
  ) {
    setError(null)
    onCardChanged(optimistic) // instant
    inFlight.current += 1
    request()
      .then((res) => {
        inFlight.current -= 1
        if (inFlight.current === 0) onCardChanged(res.data.card) // confirm against the server
      })
      .catch(() => {
        inFlight.current -= 1
        setError(failure)
        onResync()
      })
  }

  function addChecklist(title: string) {
    const checklist: ChecklistData = { id: tempId(), title, items: [] }
    mutate(
      { ...card, checklists: [...card.checklists, checklist] },
      () => api.post(base, { title }),
      'Could not add the checklist',
    )
    setAddingChecklist(false)
  }

  function renameChecklist(checklist: ChecklistData, title: string) {
    mutate(
      mapChecklist(card, checklist.id, (c) => ({ ...c, title })),
      () => api.patch(`${base}/${checklist.id}`, { title }),
      'Could not rename the checklist',
    )
  }

  function deleteChecklist(checklist: ChecklistData) {
    setPendingDelete(null)
    mutate(
      { ...card, checklists: card.checklists.filter((c) => c.id !== checklist.id) },
      () => api.delete(`${base}/${checklist.id}`),
      'Could not delete the checklist',
    )
  }

  function addItem(checklist: ChecklistData, text: string) {
    const item: ChecklistItemData = { id: tempId(), text, completed: false, completedBy: null, completedAt: null }
    mutate(
      mapChecklist(card, checklist.id, (c) => ({ ...c, items: [...c.items, item] })),
      () => api.post(`${base}/${checklist.id}/items`, { text }),
      'Could not add the item',
    )
  }

  function updateItem(checklist: ChecklistData, item: ChecklistItemData, changes: { text?: string; completed?: boolean }) {
    // completedBy/completedAt are recorded by the server from who's logged in
    mutate(
      mapItem(card, checklist.id, item.id, (i) => ({ ...i, ...changes })),
      () => api.patch(`${base}/${checklist.id}/items/${item.id}`, changes),
      'Could not update the item',
    )
  }

  function deleteItem(checklist: ChecklistData, item: ChecklistItemData) {
    mutate(
      mapChecklist(card, checklist.id, (c) => ({ ...c, items: c.items.filter((i) => i.id !== item.id) })),
      () => api.delete(`${base}/${checklist.id}/items/${item.id}`),
      'Could not delete the item',
    )
  }

  return (
    <section className="stack" style={{ gap: 16 }} aria-labelledby="checklists-heading">
      <h3 id="checklists-heading" className="sr-only">
        Checklists
      </h3>

      {card.checklists.map((checklist) => (
        <ChecklistBlock
          key={checklist.id}
          checklist={checklist}
          onRename={(title) => renameChecklist(checklist, title)}
          onDelete={() => setPendingDelete(checklist)}
          onAddItem={(text) => addItem(checklist, text)}
          onUpdateItem={(item, changes) => updateItem(checklist, item, changes)}
          onDeleteItem={(item) => deleteItem(checklist, item)}
        />
      ))}

      {addingChecklist ? (
        <NewChecklistForm onAdd={addChecklist} onCancel={() => setAddingChecklist(false)} />
      ) : (
        <div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAddingChecklist(true)}>
            + Add checklist
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="alert">
          {error} — the card was refreshed from the server.
        </p>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this checklist?"
          confirmLabel="Delete checklist"
          onConfirm={() => deleteChecklist(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        >
          <p>
            <strong>{pendingDelete.title}</strong>
            {pendingDelete.items.length > 0 &&
              ` and its ${pendingDelete.items.length} item${pendingDelete.items.length === 1 ? '' : 's'}`}{' '}
            will be removed from this card for everyone. This can't be undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  )
}

interface ChecklistBlockProps {
  checklist: ChecklistData
  onRename: (title: string) => void
  onDelete: () => void
  onAddItem: (text: string) => void
  onUpdateItem: (item: ChecklistItemData, changes: { text?: string; completed?: boolean }) => void
  onDeleteItem: (item: ChecklistItemData) => void
}

function ChecklistBlock({ checklist, onRename, onDelete, onAddItem, onUpdateItem, onDeleteItem }: ChecklistBlockProps) {
  const [newItem, setNewItem] = useState('')
  const { done, total } = checklistProgress([checklist])
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  const pendingCreate = isTemp(checklist.id)

  function submitItem(e: FormEvent) {
    e.preventDefault()
    const text = newItem.trim()
    if (!text || pendingCreate) return
    onAddItem(text)
    setNewItem('') // stays focused for fast entry of the next item
  }

  return (
    <div className="checklist" role="group" aria-label={checklist.title}>
      <div className="checklist-header">
        <InlineEdit
          value={checklist.title}
          maxLength={100}
          label="Checklist title"
          className="checklist-title"
          disabled={pendingCreate}
          onSave={onRename}
        />
        <button type="button" className="icon-btn icon-btn-danger" onClick={onDelete} disabled={pendingCreate}>
          Delete
        </button>
      </div>

      <div className="checklist-progress" aria-label={`${done} of ${total} done`}>
        <span className="mono">
          {done}/{total}
        </span>
        <span className="progress">
          <span className={`progress-bar${total > 0 && done === total ? ' is-complete' : ''}`} style={{ width: `${percent}%` }} />
        </span>
      </div>

      {checklist.items.length > 0 && (
        <ul className="checklist-items">
          {checklist.items.map((item) => (
            <li key={item.id} className={`checklist-item${item.completed ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                checked={item.completed}
                aria-label={item.text}
                disabled={isTemp(item.id)}
                onChange={(e) => onUpdateItem(item, { completed: e.target.checked })}
              />
              <InlineEdit
                value={item.text}
                maxLength={500}
                label={`Edit "${item.text}"`}
                className="checklist-item-text"
                disabled={isTemp(item.id)}
                onSave={(text) => onUpdateItem(item, { text })}
              />
              <button
                type="button"
                className="checklist-item-delete"
                aria-label={`Delete item "${item.text}"`}
                disabled={isTemp(item.id)}
                onClick={() => onDeleteItem(item)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="add-card checklist-add" onSubmit={submitItem}>
        <input
          className="input"
          value={newItem}
          maxLength={500}
          placeholder="Add an item..."
          aria-label={`Add an item to ${checklist.title}`}
          onChange={(e) => setNewItem(e.target.value)}
        />
        <button type="submit" className="btn btn-ink btn-sm" disabled={!newItem.trim() || pendingCreate}>
          Add
        </button>
      </form>
    </div>
  )
}

function NewChecklistForm({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('Checklist')

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed) onAdd(trimmed)
  }

  return (
    <form className="checklist-new" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Checklist title</span>
        <input
          className="input"
          value={title}
          maxLength={100}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault() // don't close the whole card
            onCancel()
          }}
        />
      </label>
      <div className="row">
        <button type="submit" className="btn btn-ink btn-sm" disabled={!title.trim()}>
          Add checklist
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

interface InlineEditProps {
  value: string
  label: string
  maxLength: number
  className: string
  disabled?: boolean
  onSave: (value: string) => void
}

// Click the text to edit it in place: Enter or clicking away saves, Escape cancels
function InlineEdit({ value, label, maxLength, className, disabled, onSave }: InlineEditProps) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    if (draft === null) return
    const trimmed = draft.trim()
    setDraft(null)
    if (trimmed && trimmed !== value) onSave(trimmed)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault() // cancel just this edit, don't close the whole card
      setDraft(null)
    }
  }

  if (draft === null) {
    return (
      <button type="button" className={`inline-edit ${className}`} disabled={disabled} onClick={() => setDraft(value)}>
        {value}
      </button>
    )
  }

  return (
    <input
      className={`input inline-edit-input ${className}`}
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
