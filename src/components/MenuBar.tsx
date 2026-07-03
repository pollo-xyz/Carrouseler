import { useEffect, useRef, useState } from 'react'

/**
 * In-app application menu bar for Windows / Linux. macOS uses the native
 * menu bar at the top of the screen, so this component should be hidden
 * via CSS on .platform-mac.
 *
 * Renders a thin horizontal strip with File / Edit / View dropdowns. Each
 * dropdown is a plain absolutely-positioned panel with menu items and
 * keyboard-shortcut hints. The strip itself is the window's drag region
 * (CSS rule on .menubar) so dragging an empty area moves the window;
 * interactive elements opt back out with -webkit-app-region: no-drag.
 *
 * Window-control buttons (close / minimize / maximize) are NOT rendered
 * here — they come from Electron's `titleBarOverlay` config which paints
 * native, themed controls in the top-right corner.
 */

interface RecentEntry {
  path: string
  basename: string
}

interface Props {
  recents: RecentEntry[]
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onClearRecents: () => void
  onSave: () => void
  onSaveAs: () => void
  onUndo: () => void
  onRedo: () => void
  onToggleDevTools: () => void
  onReload: () => void
  showOutlines: boolean
  onToggleOutlines: () => void
}

type OpenMenu = 'file' | 'edit' | 'view' | null

export default function MenuBar(props: Props) {
  const [open, setOpen] = useState<OpenMenu>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on click outside, on Escape, or on window blur (e.g. user
  // alt-tabs away with a menu open).
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    const onBlur = () => setOpen(null)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  // Click on a top-level label toggles its dropdown. While a menu is open,
  // hovering a sibling label switches to that menu — matches OS behaviour.
  const buttonProps = (name: Exclude<OpenMenu, null>) => ({
    className: `menubar__btn${open === name ? ' menubar__btn--active' : ''}`,
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault()
      setOpen(open === name ? null : name)
    },
    onMouseEnter: () => {
      if (open && open !== name) setOpen(name)
    },
    type: 'button' as const,
  })

  const runAndClose = (fn: () => void) => () => {
    setOpen(null)
    fn()
  }

  return (
    <div ref={rootRef} className="menubar">
      <button {...buttonProps('file')}>File</button>
      <button {...buttonProps('edit')}>Edit</button>
      <button {...buttonProps('view')}>View</button>

      {open === 'file' && (
        <div className="menubar__dropdown" style={{ left: 0 }}>
          <MenuItem label="New Project" shortcut="Ctrl+N" onClick={runAndClose(props.onNew)} />
          <MenuItem label="Open Project…" shortcut="Ctrl+O" onClick={runAndClose(props.onOpen)} />
          <Submenu label="Open Recent">
            {props.recents.length === 0 ? (
              <MenuItem label="No recent projects" onClick={() => { /* no-op */ }} disabled />
            ) : (
              <>
                {props.recents.map((r) => (
                  <MenuItem
                    key={r.path}
                    label={r.basename}
                    title={r.path}
                    onClick={runAndClose(() => props.onOpenRecent(r.path))}
                  />
                ))}
                <MenuSeparator />
                <MenuItem label="Clear Recent" onClick={runAndClose(props.onClearRecents)} />
              </>
            )}
          </Submenu>
          <MenuSeparator />
          <MenuItem label="Save Project" shortcut="Ctrl+S" onClick={runAndClose(props.onSave)} />
          <MenuItem label="Save Project As…" shortcut="Ctrl+Shift+S" onClick={runAndClose(props.onSaveAs)} />
        </div>
      )}

      {open === 'edit' && (
        <div className="menubar__dropdown" style={{ left: 36 }}>
          <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={runAndClose(props.onUndo)} />
          <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={runAndClose(props.onRedo)} />
        </div>
      )}

      {open === 'view' && (
        <div className="menubar__dropdown" style={{ left: 72 }}>
          <MenuItem
            label="Show CSS outlines"
            checked={props.showOutlines}
            onClick={runAndClose(props.onToggleOutlines)}
          />
          <MenuSeparator />
          <MenuItem label="Reload" shortcut="Ctrl+R" onClick={runAndClose(props.onReload)} />
          <MenuItem label="Toggle Developer Tools" shortcut="Ctrl+Shift+I" onClick={runAndClose(props.onToggleDevTools)} />
        </div>
      )}
    </div>
  )
}

function MenuItem({
  label, shortcut, onClick, disabled, title, checked,
}: {
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  title?: string
  checked?: boolean
}) {
  return (
    <div
      className={`menubar__item${disabled ? ' menubar__item--disabled' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      title={title}
    >
      {checked !== undefined && (
        <span className="menubar__item-check" aria-hidden>{checked ? '✓' : ''}</span>
      )}
      <span className="menubar__item-label">{label}</span>
      {shortcut && <span className="menubar__item-shortcut">{shortcut}</span>}
    </div>
  )
}

function MenuSeparator() {
  return <div className="menubar__separator" />
}

function Submenu({ label, children }: { label: string; children: React.ReactNode }) {
  // Hover-based submenu. Click handler is unnecessary because hover already
  // opens it, and clicking the parent label shouldn't dismiss the dropdown.
  return (
    <div className="menubar__item menubar__item--has-submenu">
      <span className="menubar__item-label">{label}</span>
      <span className="menubar__item-arrow" aria-hidden>›</span>
      <div className="menubar__submenu">
        {children}
      </div>
    </div>
  )
}
