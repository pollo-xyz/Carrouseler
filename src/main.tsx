import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts — no network fetch, works offline in the desktop app.
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/jetbrains-mono/index.css'
import '@fontsource/funnel-sans/400.css'
import '@fontsource/funnel-sans/500.css'
import '@fontsource/funnel-sans/700.css'
import './index.css'
import App from './App.tsx'

// Apply the persisted theme before first paint so there's no flash.
const savedTheme = localStorage.getItem('tiovivo-theme')
if (savedTheme === 'light') document.documentElement.dataset.theme = 'light'

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
