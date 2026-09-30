import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<void> | void
  onCancel: () => void
  cancelLabel?: string
  confirmDisabled?: boolean
  // An optional third choice between Cancel and Confirm (e.g. "Discard changes")
  extraAction?: { label: string; onClick: () => void }
}

// Render only while needed; it opens itself as a modal on mount.
// Esc, the × button, Cancel and clicking outside all cancel — nothing happens until Confirm.
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  extraAction,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      // Wider when there's a third button, so the actions fit on one row
      style={{ width: `min(${extraAction ? 36 : 28}rem, calc(100vw - 32px))` }}
      aria-labelledby="confirm-dialog-title"
      // React bubbles onClose from nested dialogs; only react to this dialog closing itself
      onClose={(e) => e.target === e.currentTarget && onCancel()}
      // A click that lands on the <dialog> itself (not its content) is a click on the backdrop
      onClick={(e) => e.target === e.currentTarget && !busy && dialogRef.current?.close()}
    >
      <div className="card-header">
        <h2 id="confirm-dialog-title">{title}</h2>
        <button
          type="button"
          className="modal-close"
          aria-label="Close"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="card-body stack" style={{ gap: 10 }}>
        {children}
      </div>
      <div className="modal-footer">
        {/* Cancel gets initial focus, so a stray Enter doesn't confirm */}
        <button
          type="button"
          className="btn btn-outline"
          autoFocus
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
        >
          {cancelLabel}
        </button>
        {extraAction && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={extraAction.onClick}>
            {extraAction.label}
          </button>
        )}
        <button type="button" className="btn btn-accent" disabled={busy || confirmDisabled} onClick={confirm}>
          {busy ? 'Saving...' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
