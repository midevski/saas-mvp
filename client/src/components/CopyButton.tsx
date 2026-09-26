import { useEffect, useState } from 'react'

interface CopyButtonProps {
  text: string
  label?: string
  className?: string
}

export function CopyButton({ text, label = 'Copy link', className = 'btn btn-outline btn-sm' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  // Confirmation shows briefly, then the button returns to its normal label
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])

  async function copy() {
    try {
      // Needs a secure context (https or localhost)
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed — select it' : label}
    </button>
  )
}
