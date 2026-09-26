import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '../../components/Brand'

const POINTS = [
  'Organizations with owner, admin and member roles',
  'A realtime board your whole team edits together',
  'Simple subscription billing, managed in one place',
]

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="blueprint-ink" />
        <div className="glow" style={{ top: '-8rem', right: '-8rem' }} />
        <Link to="/" className="brand">
          <Brand onInk />
        </Link>
        <div>
          <p className="eyebrow" style={{ marginBottom: 16 }}>
            <span className="dot" />
            Team workspace
          </p>
          <h2>Plan, track and ship work together — in real time.</h2>
          <ul className="auth-points">
            {POINTS.map((point) => (
              <li key={point}>
                <span className="dot" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-on-ink-muted)' }}>
          saas-mvp
        </p>
      </aside>

      <main className="auth-main blueprint">
        <div className="auth-form card card-body" style={{ background: 'var(--color-paper)' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
