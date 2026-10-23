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
 * Keyboard (WAI-ARIA menubar pattern): Enter / Space / ↓ on a menu button
 * opens it and focuses the first item; ↑ / ↓ / Home / End move; ← / →
 * switch menus (→ on "Open Recent" opens its submenu); Enter / Space
 * activate; Escape closes and returns focus to the menu button. Running
 * an item hands focus back to the control the user came from, so e.g.
 * Edit → Undo still reaches a focused text field.
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

type MenuName = 'file' | 'edit' | 'view'
type OpenMenu = MenuName | null

const MENUS: MenuName[] = ['file', 'edit', 'view']

function siblingMenu(name: MenuName, dir: 1 | -1): MenuName {
  const i = MENUS.indexOf(name)
  return MENUS[(i + dir + MENUS.length) % MENUS.length]!
}

/** The navigable rows of one menu panel — direct children only, so the
 *  parent menu never walks into its submenu's rows. */
function menuItems(menu: Element | null | undefined): HTMLElement[] {
  if (!menu) return []
  return Array.from(menu.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]'))
}

export default function MenuBar(props: Props) {
  const [open, setOpen] = useState<OpenMenu>(null)
  // "Open Recent" opened from the keyboard. The mouse path stays the CSS
  // :hover rule; this only forces the panel visible for keyboard users.
  const [subOpen, setSubOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Record<MenuName, HTMLButtonElement | null>>({ file: null, edit: null, view: null })
  // Where focus was before the user reached for the menu bar; restored
  // before an action runs.
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null)
  // Keyboard opens park the desired initial focus here until the panel renders.
  const pendingFocusRef = useRef<'first' | 'last' | null>(null)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target
      if (t instanceof HTMLElement && !rootRef.current?.contains(t)) lastOutsideFocusRef.current = t
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // Close on click outside, on Escape, or on window blur (e.g. user
  // alt-tabs away with a menu open).
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(null)
        setSubOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null)
        setSubOpen(false)
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !rootRef.current?.contains(document.activeElement)) {
        // Mouse-opened menu: arrows pull keyboard focus into it (OS menus
        // capture the keyboard too) instead of nudging canvas items.
        e.preventDefault()
        e.stopPropagation()
        const items = menuItems(menuRef.current)
        ;(e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus()
      }
    }
    const onBlur = () => {
      setOpen(null)
      setSubOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [open])

  // Keyboard open: focus the first / last row once the panel exists.
  useEffect(() => {
    const where = pendingFocusRef.current
    if (!open || !where) return
    pendingFocusRef.current = null
    const items = menuItems(menuRef.current)
    ;(where === 'last' ? items[items.length - 1] : items[0])?.focus()
  }, [open])

  // Keyboard-opened submenu: move focus onto its first row.
  useEffect(() => {
    if (!subOpen) return
    menuItems(menuRef.current?.querySelector('.menubar__submenu'))[0]?.focus()
  }, [subOpen])

  const openMenu = (name: MenuName, focus: 'first' | 'last' | null) => {
    setSubOpen(false)
    if (open === name) {
      // Already showing (e.g. mouse-opened) — just move focus in.
      if (focus) {
        const items = menuItems(menuRef.current)
        ;(focus === 'last' ? items[items.length - 1] : items[0])?.focus()
      }
      return
    }
    pendingFocusRef.current = focus
    setOpen(name)
  }

  /** Close the open menu. Focus only moves if it was inside the menu bar
   *  (keyboard use); a mouse-opened menu never took focus to begin with. */
  const close = (refocus: 'trigger' | 'restore') => {
    const name = open
    const focusInside = !!rootRef.current?.contains(document.activeElement)
    setOpen(null)
    setSubOpen(false)
    if (!focusInside) return
    if (refocus === 'trigger') {
      if (name) btnRefs.current[name]?.focus()
      return
    }
    const back = lastOutsideFocusRef.current
    if (back?.isConnected) back.focus()
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  // Click on a top-level label toggles its dropdown. While a menu is open,
  // hovering a sibling label switches to that menu — matches OS behaviour.
  const buttonProps = (name: MenuName) => ({
    ref: (el: HTMLButtonElement | null) => {
      btnRefs.current[name] = el
    },
    id: `menubar-btn-${name}`,
    className: `menubar__btn${open === name ? ' menubar__btn--active' : ''}`,
    role: 'menuitem' as const,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open === name,
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault()
      setSubOpen(false)
      setOpen(open === name ? null : name)
    },
    onMouseEnter: () => {
      if (open && open !== name) {
        setSubOpen(false)
        setOpen(name)
      }
    },
    // Screen-reader activation arrives as a synthetic click (detail 0);
    // real mouse clicks were already handled on mousedown.
    onClick: (e: React.MouseEvent) => {
      if (e.detail !== 0) return
      if (open === name) close('trigger')
      else openMenu(name, 'first')
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') openMenu(name, 'first')
      else if (e.key === 'ArrowUp') openMenu(name, 'last')
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const next = siblingMenu(name, e.key === 'ArrowRight' ? 1 : -1)
        btnRefs.current[next]?.focus()
        if (open) openMenu(next, null)
      } else return
      // Handled here — keep window-level canvas shortcuts (Space pan,
      // arrow nudges) from also acting on it.
      e.preventDefault()
      e.stopPropagation()
    },
    type: 'button' as const,
  })

  // Arrow / Home / End / Escape / Tab inside an open panel (and its
  // submenu — keys bubble up from there). Enter / Space are handled by
  // the rows themselves.
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    const target = e.target as HTMLElement
    const menu = target.closest<HTMLElement>('[role="menu"]')
    if (!menu) return
    const inSub = menu !== e.currentTarget
    const items = menuItems(menu)
    const idx = items.indexOf(target)
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus()
    const opensSub = target.getAttribute('aria-haspopup') === 'menu'
    const backToParent = () => {
      setSubOpen(false)
      menu.parentElement?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
        if (!inSub) setSubOpen(false)
        focusAt(idx + 1)
        break
      case 'ArrowUp':
        if (!inSub) setSubOpen(false)
        focusAt(idx < 0 ? items.length - 1 : idx - 1)
        break
      case 'Home':
        focusAt(0)
        break
      case 'End':
        focusAt(items.length - 1)
        break
      case 'ArrowRight':
        if (opensSub) setSubOpen(true)
        else openMenu(siblingMenu(open, 1), 'first')
        break
      case 'ArrowLeft':
        if (inSub) backToParent()
        else openMenu(siblingMenu(open, -1), 'first')
        break
      case 'Enter':
      case ' ':
        if (!opensSub) return
        setSubOpen(true)
        break
      case 'Escape':
        if (inSub) backToParent()
        else close('trigger')
        break
      case 'Tab':
        // Leave the menu; the browser's Tab then continues from the button.
        close('trigger')
        return
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const panelProps = (name: MenuName, left: number) => ({
    ref: menuRef,
    className: 'menubar__dropdown',
    style: { left },
    role: 'menu' as const,
    'aria-labelledby': `menubar-btn-${name}`,
    onKeyDown: onMenuKeyDown,
  })

  const runAndClose = (fn: () => void) => () => {
    close('restore')
    fn()
  }

  return (
    <div ref={rootRef} className="menubar" role="menubar" aria-label="Application menu">
      <button {...buttonProps('file')}>File</button>
      <button {...buttonProps('edit')}>Edit</button>
      <button {...buttonProps('view')}>View</button>

      {open === 'file' && (
        <div {...panelProps('file', 0)}>
          <MenuItem label="New Project" shortcut="Ctrl+N" onClick={runAndClose(props.onNew)} />
          <MenuItem label="Open Project…" shortcut="Ctrl+O" onClick={runAndClose(props.onOpen)} />
          <Submenu label="Open Recent" open={subOpen}>
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
        <div {...panelProps('edit', 36)}>
          <MenuItem label="Undo" shortcut="Ctrl+Z" onClick={runAndClose(props.onUndo)} />
          <MenuItem label="Redo" shortcut="Ctrl+Y" onClick={runAndClose(props.onRedo)} />
        </div>
      )}

      {open === 'view' && (
        <div {...panelProps('view', 72)}>
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
      role={checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      // Focusable for arrow-key navigation, but not a Tab stop.
      tabIndex={-1}
      onMouseDown={(e) => {
        // preventDefault keeps focus where it was (e.g. a text field that
        // Edit → Undo should act on).
        e.preventDefault()
        if (!disabled) onClick()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
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
  return <div className="menubar__separator" role="separator" />
}

function Submenu({ label, open, children }: { label: string; open: boolean; children: React.ReactNode }) {
  // Mouse: the CSS :hover rule shows the panel. Keyboard: → / Enter on
  // this row sets `open` (see MenuBar's onMenuKeyDown), which forces the
  // panel visible inline since the hover rule can't fire.
  return (
    <div
      className="menubar__item menubar__item--has-submenu"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={open}
      tabIndex={-1}
    >
      <span className="menubar__item-label">{label}</span>
      <span className="menubar__item-arrow" aria-hidden>›</span>
      <div className="menubar__submenu" role="menu" aria-label={label} style={open ? { display: 'block' } : undefined}>
        {children}
      </div>
    </div>
  )
}
