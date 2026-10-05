import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import axios from 'axios'
import { api } from '../../lib/api/axiosInstance'
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/imageUpload'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { AttachmentData, CardData } from './boardState'
import { ChecklistSection } from './ChecklistSection'
import { ActivityFeed } from './ActivityFeed'

interface CardDetailViewProps {
  orgId: string
  // Always the live card from board state, so remote changes (e.g. someone else's upload) show up
  card: CardData
  onClose: () => void
  onSave: (card: CardData, title: string, description: string | null) => void
  // REST responses carry the updated card; applying them right away avoids waiting for the broadcast
  onCardChanged: (card: CardData) => void
  // Re-sync the board from the server after a failed change
  onResync: () => void
  // A comment to scroll to and highlight (e.g. opened from a mention notification)
  highlightActivityId?: string | null
}

interface UploadState {
  filename: string
  index: number
  total: number
  progress: number // 0..1
}

function uploadError(err: unknown, filename: string) {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  switch (status) {
    case 413:
      return `"${filename}" is too large. Images must be 5 MB or smaller.`
    case 415:
      return `"${filename}" isn't a supported image. Use JPEG, PNG, WebP or GIF.`
    case 402:
      return 'This organization needs an active subscription to add images.'
    case 404:
      return 'This card no longer exists.'
    default:
      return `Could not upload "${filename}". Please try again.`
  }
}

export function CardDetailView({
  orgId,
  card,
  onClose,
  onSave,
  onCardChanged,
  onResync,
  highlightActivityId = null,
}: CardDetailViewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState<UploadState | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [preview, setPreview] = useState<AttachmentData | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AttachmentData | null>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  // The description box grows to fit its text (capped by CSS max-height), so a long
  // description can actually be read here rather than in a tiny scrolling box
  useLayoutEffect(() => {
    const el = descriptionRef.current
    if (!el) return
    el.style.height = 'auto'
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }, [description])

  const attachmentsUrl = `/orgs/${orgId}/board/cards/${card.id}/attachments`
  const isDirty = title.trim() !== card.title || (description.trim() || null) !== card.description

  function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    onSave(card, trimmed, description.trim() || null)
    setSaved(true)
  }

  // Closing with unsaved title/description edits asks first: save, discard, or keep editing
  function requestClose() {
    if (isDirty) setConfirmingClose(true)
    else dialogRef.current?.close()
  }

  function saveAndClose() {
    onSave(card, title.trim(), description.trim() || null)
    dialogRef.current?.close()
  }

  function discardAndClose() {
    setConfirmingClose(false)
    dialogRef.current?.close()
  }

  // Reloading or closing the browser tab can't show our prompt — let the browser ask instead
  useEffect(() => {
    if (!isDirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const changedFields = [
    title.trim() !== card.title && 'title',
    (description.trim() || null) !== card.description && 'description',
  ].filter(Boolean)

  async function uploadFiles(files: File[]) {
    setErrors([])
    const problems: string[] = []
    // Fast client-side feedback; the server enforces the same rules regardless
    const valid = files.filter((file) => {
      const problem = validateImageFile(file)
      if (problem) problems.push(problem)
      return !problem
    })

    for (const [i, file] of valid.entries()) {
      setUploading({ filename: file.name, index: i + 1, total: valid.length, progress: 0 })
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await api.post(attachmentsUrl, form, {
          onUploadProgress: (e) => {
            const progress = e.total ? e.loaded / e.total : 0
            setUploading((u) => (u ? { ...u, progress } : u))
          },
        })
        onCardChanged(res.data.card)
      } catch (err) {
        problems.push(uploadError(err, file.name))
      }
    }
    setUploading(null)
    setErrors(problems)
  }

  async function deleteAttachment(attachment: AttachmentData) {
    try {
      const res = await api.delete(`${attachmentsUrl}/${attachment.id}`)
      onCardChanged(res.data.card)
    } catch {
      setErrors([`Could not delete "${attachment.filename}". Please try again.`])
    } finally {
      setPendingDelete(null)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
    if (uploading) return
    void uploadFiles([...e.dataTransfer.files])
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setIsDraggingOver(true)
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-wide"
      aria-labelledby="card-detail-title"
      // The lightbox and confirmations are nested dialogs: React bubbles their close/cancel
      // events up to here, so only react to this dialog's own
      onClose={(e) => e.target === e.currentTarget && onClose()}
      // Escape: with unsaved edits, ask instead of closing
      onCancel={(e) => {
        if (e.target !== e.currentTarget || !isDirty) return
        e.preventDefault()
        setConfirmingClose(true)
      }}
    >
      <div className="card-header">
        <div className="card-title">
          <span className="eyebrow">Card</span>
          <h2 id="card-detail-title">{card.title}</h2>
        </div>
        <button type="button" className="modal-close" aria-label="Close" onClick={requestClose}>
          ×
        </button>
      </div>

      <div className="card-body stack" style={{ gap: 24 }}>
        <form onSubmit={save} className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="input"
              value={title}
              maxLength={200}
              required
              onChange={(e) => {
                setTitle(e.target.value)
                setSaved(false)
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <textarea
              ref={descriptionRef}
              className="textarea textarea-autosize"
              value={description}
              maxLength={5000}
              placeholder="Add more detail..."
              onChange={(e) => {
                setDescription(e.target.value)
                setSaved(false)
              }}
            />
          </label>
          <div className="row">
            <button type="submit" className="btn btn-ink btn-sm" disabled={!isDirty || !title.trim()}>
              Save changes
            </button>
            {saved && !isDirty && (
              <span className="mono faint" role="status" style={{ fontSize: '0.75rem' }}>
                Saved
              </span>
            )}
          </div>
        </form>

        <section className="stack" style={{ gap: 12 }} aria-labelledby="attachments-heading">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 id="attachments-heading">Images</h3>
            <span className="pill">{card.attachments.length}</span>
          </div>

          {card.attachments.length > 0 && (
            <ul className="attachment-grid">
              {card.attachments.map((attachment) => (
                <li key={attachment.id} className="attachment-thumb">
                  <button
                    type="button"
                    className="attachment-open"
                    aria-label={`View ${attachment.filename}`}
                    onClick={() => setPreview(attachment)}
                  >
                    <img src={attachment.url} alt={attachment.filename} loading="lazy" />
                  </button>
                  <button
                    type="button"
                    className="attachment-delete"
                    aria-label={`Delete ${attachment.filename}`}
                    onClick={() => setPendingDelete(attachment)}
                  >
                    ×
                  </button>
                  <span className="attachment-name" title={attachment.filename}>
                    {attachment.filename}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <label
            className={`dropzone${isDraggingOver ? ' is-over' : ''}${uploading ? ' is-busy' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              className="sr-only"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              multiple
              disabled={!!uploading}
              aria-label="Add image"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = '' // allow picking the same file again
                if (files.length) void uploadFiles(files)
              }}
            />
            {uploading ? (
              <span className="stack" style={{ gap: 8, width: '100%' }} role="status">
                <span>
                  Uploading {uploading.total > 1 && `${uploading.index} of ${uploading.total}: `}
                  <strong>{uploading.filename}</strong> — {Math.round(uploading.progress * 100)}%
                </span>
                <span className="progress">
                  <span className="progress-bar" style={{ width: `${uploading.progress * 100}%` }} />
                </span>
              </span>
            ) : (
              <span>
                <strong>Add image</strong> — drop files here or click to browse
                <span className="dropzone-hint">JPEG, PNG, WebP or GIF · up to 5 MB</span>
              </span>
            )}
          </label>

          {errors.map((error) => (
            <p key={error} role="alert" className="alert">
              {error}
            </p>
          ))}
        </section>

        <ChecklistSection orgId={orgId} card={card} onCardChanged={onCardChanged} onResync={onResync} />

        <ActivityFeed orgId={orgId} cardId={card.id} highlightId={highlightActivityId} />
      </div>

      {preview && <Lightbox attachment={preview} onClose={() => setPreview(null)} />}

      {confirmingClose && (
        <ConfirmDialog
          title="Save your changes?"
          confirmLabel="Save changes"
          // A card can't be saved without a title
          confirmDisabled={!title.trim()}
          cancelLabel="Keep editing"
          extraAction={{ label: 'Discard changes', onClick: discardAndClose }}
          onConfirm={saveAndClose}
          onCancel={() => setConfirmingClose(false)}
        >
          <p>
            You changed this card's {changedFields.join(' and ')} but haven't saved.
            {!title.trim() && ' The title is empty, so these changes can only be discarded.'}
          </p>
        </ConfirmDialog>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this image?"
          confirmLabel="Delete image"
          onConfirm={() => deleteAttachment(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        >
          <p>
            <strong>{pendingDelete.filename}</strong> will be removed from this card for everyone. This can't be
            undone.
          </p>
        </ConfirmDialog>
      )}
    </dialog>
  )
}

// Full-size view; click outside the image, press Esc, or use × to close
function Lightbox({ attachment, onClose }: { attachment: AttachmentData; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      aria-label={attachment.filename}
      onClose={(e) => e.target === e.currentTarget && onClose()}
      // Anywhere except the image itself or a control closes it
      onClick={(e) => !(e.target as HTMLElement).closest('img, a, button') && dialogRef.current?.close()}
    >
      <button type="button" className="lightbox-close" aria-label="Close" onClick={() => dialogRef.current?.close()}>
        ×
      </button>
      <figure>
        <img src={attachment.url} alt={attachment.filename} />
        <figcaption>
          <span>{attachment.filename}</span>
          <a href={attachment.url} target="_blank" rel="noreferrer" className="link-underline">
            Open original
          </a>
        </figcaption>
      </figure>
    </dialog>
  )
}
