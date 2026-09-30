import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: string
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" strokeLinecap="round" />}
    </svg>
  )
}

// Password field with a show/hide toggle. The label is linked by id (not wrapping), so the
// input's accessible name stays just the label rather than also absorbing the button's.
export function PasswordInput({ label, className = 'input', ...inputProps }: PasswordInputProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [visible, setVisible] = useState(false)

  // Back to hidden when the form is submitted: password managers decide whether to offer
  // saving based on the field being a password field at that moment
  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const hide = () => setVisible(false)
    form.addEventListener('submit', hide)
    return () => form.removeEventListener('submit', hide)
  }, [])

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input ref={inputRef} id={id} type={visible ? 'text' : 'password'} className={className} {...inputProps} />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          // Keep focus (and the caret) in the field, so typing can continue
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
        >
          <EyeIcon open={!visible} />
        </button>
      </div>
    </div>
  )
}
