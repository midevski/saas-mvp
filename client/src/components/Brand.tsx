export function Brand({ onInk = false }: { onInk?: boolean }) {
  return (
    <>
      <span className="brand-mark">S</span>
      <span className="brand-name" style={onInk ? { color: 'var(--color-on-ink)' } : undefined}>
        saas<span style={{ color: onInk ? 'var(--color-on-ink-muted)' : 'var(--color-fg-muted)' }}>-mvp</span>
      </span>
    </>
  )
}
