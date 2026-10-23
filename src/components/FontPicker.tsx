import { useEffect, useId, useMemo, useRef, useState } from 'react'

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
 * actual text item. Previews are TRANSIENT: apply them without an undo
 * entry or dirty flag (e.g. the store's syncItemMeasurements). Before a
 * commit the picker previews the opening value back, so the parent's
 * commit (updateItem) records exactly one "original → new font" step —
 * and nothing at all when the user cancels or re-picks the same font.
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
  // Has a preview been applied since the picker opened? Tracked here rather
  // than inferred from `value`, which may not have re-rendered yet.
  const previewedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return fonts
    return fonts.filter((f) => f.toLowerCase().includes(q))
  }, [fonts, query])

  const openDropdown = () => {
    if (open) return
    openValueRef.current = value
    previewedRef.current = false
    setQuery('')
    setOpen(true)
    // Start the active row on the current value if present, else first.
    const idx = fonts.indexOf(value)
    setActiveIndex(idx >= 0 ? idx : 0)
    onOpen?.()
  }

  const preview = (font: string) => {
    previewedRef.current = true
    onPreview(font)
  }

  /** Undo any live preview — back to the font the picker opened with. */
  const revertPreview = () => {
    if (!previewedRef.current) return
    previewedRef.current = false
    onPreview(openValueRef.current)
  }

  const commit = (font: string) => {
    setOpen(false)
    setQuery('')
    // Previews bypass history, so put the opening font back first — the
    // commit then lands as one undo step from the real starting point.
    revertPreview()
    if (font !== openValueRef.current) onCommit(font)
  }

  const cancel = () => {
    setOpen(false)
    setQuery('')
    // If a hover-preview drifted the canvas away from the opening value,
    // snap it back. No-op when nothing was previewed.
    revertPreview()
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
      if (f) preview(f)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      const next = Math.max(0, activeIndex - 1)
      setActiveIndex(next)
      const f = filtered[next]
      if (f) preview(f)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Closed (e.g. right after Escape) → activeIndex is stale; committing
      // it would apply the font the user just cancelled.
      if (!open) return
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
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[activeIndex] ? optionId(activeIndex) : undefined}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="font-picker__list" ref={listRef} id={listId} role="listbox" aria-label="Fonts">
          {filtered.length === 0 ? (
            <li className="font-picker__empty" role="option" aria-selected={false} aria-disabled>
              No matches
            </li>
          ) : (
            filtered.map((font, i) => (
              <li
                key={font}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                className={`font-picker__item${i === activeIndex ? ' font-picker__item--active' : ''}${font === value ? ' font-picker__item--current' : ''}`}
                style={{ fontFamily: `'${font.replace(/'/g, "\\'")}', system-ui` }}
                onMouseEnter={() => {
                  setActiveIndex(i)
                  preview(font)
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
