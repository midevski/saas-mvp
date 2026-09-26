export interface CursorThrottle<T> {
  push(position: T): void
  // Drop any pending position (e.g. the pointer left the window)
  cancel(): void
}

// Turns a raw stream of positions (mousemove fires dozens of times a second) into at most one
// emit per `intervalMs`. The first move of a burst goes out immediately; after that, the
// *latest* position is sent at the end of each interval — never an average or a stale point,
// and the final resting position is always delivered.
export function createCursorThrottle<T>(intervalMs: number, emit: (position: T) => void): CursorThrottle<T> {
  let lastEmitAt = -Infinity
  let pending: { position: T } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush() {
    timer = null
    if (!pending) return
    lastEmitAt = Date.now()
    emit(pending.position)
    pending = null
  }

  return {
    push(position) {
      pending = { position }
      if (timer) return // already scheduled; it will send this newest position
      const wait = intervalMs - (Date.now() - lastEmitAt)
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}
