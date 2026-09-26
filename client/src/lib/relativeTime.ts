const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]

// "in 5 days", "tomorrow", "in 3 hours", "2 minutes ago"
export function relativeTime(date: string | Date, now: number = Date.now()): string {
  const diff = new Date(date).getTime() - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit)
  }
  return ''
}
