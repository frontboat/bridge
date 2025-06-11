import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StarknetProvider } from './providers/starknet-provider.tsx'
import { AuthProvider } from './providers/auth-provider.tsx'
import { ProgressProvider } from './providers/progress-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StarknetProvider>
      <AuthProvider>
        <ProgressProvider>
          <App />
        </ProgressProvider>
      </AuthProvider>
    </StarknetProvider>
  </StrictMode>,
)
