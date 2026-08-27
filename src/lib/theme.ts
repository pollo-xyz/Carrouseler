import { create } from 'zustand'

/**
 * App theme — Onyx (dark, default) and Cream (warm light).
 * The palette lives in index.css under [data-theme]; this module owns the
 * switch, persistence, and the JS-side colors that CSS variables can't
 * reach (canvas 2D fills, hex luminance math).
 */

export type ThemeName = 'onyx' | 'cream'

const STORAGE_KEY = 'tiovivo-theme'

/** Legacy default pasteboard color. Stored in .vpost files and the store as
 *  a sentinel meaning "auto — follow the app theme". Projects that saved an
 *  explicit different color keep it verbatim. */
export const WORKSPACE_AUTO = '#0a0a0e'

/** Theme-resolved pasteboard colors. Keep in sync with --canvas-bg in
 *  index.css — canvas 2D fillStyle and luminance math need concrete hex. */
const CANVAS_BG: Record<ThemeName, string> = {
  onyx: '#1a1a19',
  cream: '#e8e8e5',
}

/** Resolve the stored pasteboard color against the active theme. */
export function resolveWorkspaceBg(color: string | undefined | null, theme: ThemeName): string {
  const c = (color || WORKSPACE_AUTO).toLowerCase()
  return c === WORKSPACE_AUTO ? CANVAS_BG[theme] : c
}

/* DOM/localStorage guards keep this module importable outside the browser
   (the store imports WORKSPACE_AUTO and is unit-tested under node). */

/** Native window-control overlay colours per theme (Windows / Linux). `color`
 *  is the bar background (match the .menubar strip); `symbolColor` the glyphs. */
const TITLE_OVERLAY: Record<ThemeName, { color: string; symbolColor: string }> = {
  onyx:  { color: '#151514', symbolColor: '#f2f1ee' },
  cream: { color: '#f5f5f3', symbolColor: '#252523' },
}

function applyTitleOverlay(theme: ThemeName) {
  // Retry once on the next tick: at first paint the preload bridge may not be
  // wired yet, which previously left the overlay stuck at the dark default
  // (dark buttons on the Cream theme).
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.setTitleOverlay) return
  api.setTitleOverlay(TITLE_OVERLAY[theme])
}

function applyToDom(theme: ThemeName) {
  if (typeof document === 'undefined') return
  if (theme === 'cream') document.documentElement.dataset.theme = 'cream'
  else delete document.documentElement.dataset.theme
  // Retint the native min/max/close buttons to match (no-op outside Electron).
  applyTitleOverlay(theme)
  if (typeof window !== 'undefined') {
    setTimeout(() => applyTitleOverlay(theme), 0)
  }
}

function readStored(): ThemeName {
  if (typeof localStorage === 'undefined') return 'onyx'
  const v = localStorage.getItem(STORAGE_KEY)
  // Migrate the earlier dark/light naming.
  if (v === 'cream' || v === 'light') return 'cream'
  return 'onyx'
}

/** Where the theme flip's circular reveal grows from (usually the toggle
 *  button). Falls back to the top-right corner, where the toggle lives. */
export interface FlipOrigin {
  x: number
  y: number
}

/* toqe's signature theme flip: the new theme sweeps the screen as a crisp
   expanding circle from the click point, via the View Transitions API.
   A crisp clip-path circle is GPU-composited; a feathered mask would
   raster on the main thread and read as jitter. index.css disables the
   default cross-fade so only this reveal plays. */
function flipWithReveal(apply: () => void, origin?: FlipOrigin) {
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof document === 'undefined' || !document.startViewTransition || reduced) {
    apply()
    return
  }
  // Freeze CSS transitions for the flip's duration — the wipe must reveal
  // the FINISHED new theme, not chrome mid-way through its own 280ms fades.
  document.documentElement.classList.add('theme-flipping')
  const t = document.startViewTransition(apply)
  t.finished.finally(() => document.documentElement.classList.remove('theme-flipping'))
  t.ready
    .then(() => {
      const x = origin?.x ?? window.innerWidth - 90
      const y = origin?.y ?? 28
      const end = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {
      /* transition skipped (rapid toggling) — the theme is applied either way */
    })
}

interface ThemeState {
  theme: ThemeName
  setTheme: (t: ThemeName, origin?: FlipOrigin) => void
  toggleTheme: (origin?: FlipOrigin) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStored(),
  setTheme: (t, origin) => {
    flipWithReveal(() => {
      applyToDom(t)
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, t)
      set({ theme: t })
    }, origin)
  },
  toggleTheme: (origin) => {
    get().setTheme(get().theme === 'onyx' ? 'cream' : 'onyx', origin)
  },
}))

/** Apply the persisted theme before first paint (called from main.tsx). */
export function initTheme() {
  applyToDom(readStored())
}
