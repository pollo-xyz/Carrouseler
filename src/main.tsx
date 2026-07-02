import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Tag the body with the platform so CSS can conditionally style chrome —
// e.g. the macOS-only 82px left padding for traffic-light buttons. We use
// userAgent rather than process.platform because nodeIntegration is off.
const ua = navigator.userAgent
if (/Mac/.test(ua)) document.body.classList.add('platform-mac')
else if (/Windows/.test(ua)) document.body.classList.add('platform-win')
else document.body.classList.add('platform-other')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
