import { createContext, useContext, useState, type ReactNode } from 'react'

// Shared between the app shell (navbar) and the page inside it
interface ShellContextValue {
  // A spot in the navbar that a page can render into via a portal — the board page puts its
  // presence avatars there, which keeps them inside the board's own data providers
  headerSlot: HTMLElement | null
  // Bumped whenever an invite is created from the navbar, so lists (e.g. pending invites) refetch
  invitesVersion: number
  notifyInvited: () => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

export function ShellProvider({ headerSlot, children }: { headerSlot: HTMLElement | null; children: ReactNode }) {
  const [invitesVersion, setInvitesVersion] = useState(0)
  return (
    <ShellContext.Provider
      value={{ headerSlot, invitesVersion, notifyInvited: () => setInvitesVersion((v) => v + 1) }}
    >
      {children}
    </ShellContext.Provider>
  )
}

export function useShell() {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used within ShellProvider')
  return ctx
}
