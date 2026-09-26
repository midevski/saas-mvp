import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import { useAuth } from './AuthContext'
import { socket } from '../lib/socket'

interface SocketContextValue {
  socket: Socket
  isConnected: boolean
}

const SocketContext = createContext<SocketContextValue | null>(null)

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [isConnected, setIsConnected] = useState(socket.connected)

  useEffect(() => {
    const onConnect = () => setIsConnected(true)
    const onDisconnect = () => setIsConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // Connect once authenticated; disconnect on logout (or when a different user logs in,
  // so the next handshake is made with their token)
  useEffect(() => {
    if (!user) return
    socket.connect()
    return () => {
      socket.disconnect()
    }
  }, [user])

  return <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
}

export function useSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) throw new Error('useSocket must be used within SocketProvider')
  return ctx
}
