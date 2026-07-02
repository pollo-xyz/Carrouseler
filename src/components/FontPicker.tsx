import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Custom font combobox.
 *
 *   • Opens to the full font list (not filtered) when focused.
 *   • Each row is rendered in its own family so the user sees what the font
 *     actually looks like — like Figma / Pages / Photoshop.
 *   • Type to substring-filter (case-insensitive).
 *   • Arrow keys + Enter to navigate / commit. Esc closes and reverts the
 *     canvas to whatever was set when the picker opened.
 *   • Hover or arrow-nav previews the font on the canvas via `onPreview`.
 *     Mouse-click or Enter calls `onCommit` with the final value.
 *
 * The parent is responsible for applying preview / commit values to the
 * actual text item (typically by calling `updateItem({ fontFamily })`).
 * The store's history coalescing collapses preview spam into one entry,
 * so undo behaves like a single "font change" no matter how many fonts
 * the user hovered through.
 */
interface Props {
  value: string
  fonts: string[]
  onCommit: (font: string) => void
  onPreview: (font: string) => void
  onOpen?: () => void
  placeholder?: string
}

export default function FontPicker({
  value,
  fonts,
  onCommit,
  onPreview,
  onOpen,
  placeholder = 'Inter',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  // Snapshot of the canvas value at the moment the picker opened. Used to
  // revert when the user cancels (Esc or click-outside) so a hovered preview
  // doesn't get left behind.
  const openValueRef = useRef(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return fonts
    return fonts.filter((f) => f.toLowerCase().includes(q))
  }, [fonts, query])

  const openDropdown = () => {
    if (open) return
    openValueRef.current = value
    setQuery('')
    setOpen(true)
    // Start the active row on the current value if present, else first.
    const idx = fonts.indexOf(value)
    setActiveIndex(idx >= 0 ? idx : 0)
    onOpen?.()
  }

  const commit = (font: string) => {
    setOpen(false)
    setQuery('')
    onCommit(font)
  }

  const cancel = () => {
    setOpen(false)
    setQuery('')
    // If a hover-preview drifted the canvas away from the opening value,
    // snap it back. No-op when nothing changed.
    if (openValueRef.current !== value) onPreview(openValueRef.current)
  }

  // Click-outside closes + reverts.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) cancel()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value])

  // Keep the active row scrolled into view as it changes.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  // Clamp activeIndex when the filter shrinks the list.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1))
  }, [filtered.length, activeIndex])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        openDropdown()
        return
      }
      const next = Math.min(filtered.length - 1, activeIndex + 1)
      setActiveIndex(next)
      const f = filtered[next]
      if (f) onPreview(f)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      const next = Math.max(0, activeIndex - 1)
      setActiveIndex(next)
      const f = filtered[next]
      if (f) onPreview(f)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const f = filtered[activeIndex]
      if (f) commit(f)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Tab') {
      // Let tab move focus naturally; treat as commit-or-cancel.
      // If a row is highlighted via keyboard nav we'll have already previewed
      // it — committing here is the least surprising behaviour.
      if (open && filtered[activeIndex]) commit(filtered[activeIndex]!)
    }
  }

  return (
    <div className="font-picker" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="font-picker__input"
        value={open ? query : value}
        placeholder={placeholder}
        spellCheck={false}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="font-picker__list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <li className="font-picker__empty">No matches</li>
          ) : (
            filtered.map((font, i) => (
              <li
                key={font}
                role="option"
                aria-selected={i === activeIndex}
                className={`font-picker__item${i === activeIndex ? ' font-picker__item--active' : ''}${font === value ? ' font-picker__item--current' : ''}`}
                style={{ fontFamily: `'${font.replace(/'/g, "\\'")}', system-ui` }}
                onMouseEnter={() => {
                  setActiveIndex(i)
                  onPreview(font)
                }}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input doesn't blur-cancel first.
                  e.preventDefault()
                  commit(font)
                }}
              >
                {font}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
