import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts — no network fetch, works offline in the desktop app.
// Inter (rsms.me) — the variable `opsz` cut carries both the text axis and
// the Display optical size. Body text uses it flat; the display voice
// (wordmark, panel titles) forces a higher `opsz` for the Display cut.
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/inter/opsz-italic.css'
import './index.css'
import App from './App.tsx'
import { initTheme } from './lib/theme'
import { initLicense } from './lib/license'

// Apply the persisted theme before first paint so there's no flash.
initTheme()

// Load the cached license status and revalidate once in the background.
initLicense()

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
