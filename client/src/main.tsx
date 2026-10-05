import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { OrgProvider } from './context/OrgContext.tsx'
import { SocketProvider } from './context/SocketContext.tsx'
import { NotificationProvider } from './context/NotificationContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <OrgProvider>
            <NotificationProvider>
              <App />
            </NotificationProvider>
          </OrgProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
