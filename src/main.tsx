import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts — no network fetch, works offline in the desktop app.
// Inter (rsms.me) — the variable `opsz` cut carries both the text axis and
// the Display optical size. Body text uses it flat.
// Funnel Display + Funnel Sans — the family faces shared with Plaza and
// toqe: Display for the brand/display voice, Sans for tracked micro-labels.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import '@fontsource-variable/funnel-display'
import '@fontsource-variable/funnel-sans'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'

// Apply the persisted theme before first paint so there's no flash.
initTheme()

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
