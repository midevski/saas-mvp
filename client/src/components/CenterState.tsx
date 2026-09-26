import type { ReactNode } from 'react'

// Full-height centered message for loading / error states outside a normal page layout
export function CenterState({ children }: { children: ReactNode }) {
  return (
    <div className="center-state">
      <div className="stack" style={{ alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}
