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
  onyx: '#17171d',
  cream: '#e6e2d7',
}

/** Resolve the stored pasteboard color against the active theme. */
export function resolveWorkspaceBg(color: string | undefined | null, theme: ThemeName): string {
  const c = (color || WORKSPACE_AUTO).toLowerCase()
  return c === WORKSPACE_AUTO ? CANVAS_BG[theme] : c
}

/* DOM/localStorage guards keep this module importable outside the browser
   (the store imports WORKSPACE_AUTO and is unit-tested under node). */

function applyToDom(theme: ThemeName) {
  if (typeof document === 'undefined') return
  if (theme === 'cream') document.documentElement.dataset.theme = 'cream'
  else delete document.documentElement.dataset.theme
}

function readStored(): ThemeName {
  if (typeof localStorage === 'undefined') return 'onyx'
  const v = localStorage.getItem(STORAGE_KEY)
  // Migrate the earlier dark/light naming.
  if (v === 'cream' || v === 'light') return 'cream'
  return 'onyx'
}

interface ThemeState {
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStored(),
  setTheme: (t) => {
    applyToDom(t)
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, t)
    set({ theme: t })
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'onyx' ? 'cream' : 'onyx')
  },
}))

/** Apply the persisted theme before first paint (called from main.tsx). */
export function initTheme() {
  applyToDom(readStored())
}
