import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: ReactNode
  lede?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, lede, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <p className="eyebrow">
          <span className="dot" />
          {eyebrow}
        </p>
        <h1>{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}
