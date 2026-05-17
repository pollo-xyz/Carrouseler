import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  trending as giphyTrending,
  search as giphySearch,
  hasGiphyKey,
  type GiphyItem,
  type GiphyKind,
} from '../lib/giphy'

/**
 * Anchored popover that lets the user search Giphy and click a result to
 * drop it onto the active slide.
 *
 * UX:
 *   • Opens with trending GIFs (or stickers, depending on the tab).
 *   • Typing in the search box debounces ~250 ms then queries.
 *   • Tabs switch between Giphy's `gifs` and `stickers` endpoints. Stickers
 *     are transparent-background GIFs.
 *   • Clicking a result fires `onPick` with the result; the parent is
 *     responsible for downloading the bytes and adding the item.
 *
 * The picker is purposefully passive about state — no global store usage —
 * so it stays portable and easy to test.
 */

interface Props {
  open: boolean
  onClose: () => void
  onPick: (item: GiphyItem) => void
  /** Anchor element for positioning. The popover lays out underneath it. */
  anchorRef: React.RefObject<HTMLElement | null>
}

export default function GifPicker({ open, onClose, onPick, anchorRef }: Props) {
  const [kind, setKind] = useState<GiphyKind>('gifs')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<GiphyItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track the in-flight fetch so a slow request from a stale query doesn't
  // overwrite a fresher query's results when it finally resolves.
  const queryIdRef = useRef(0)

  // Compute popover position based on the anchor button's bounding rect.
  // Position is fixed (viewport coords) so it sticks even if the sidebar
  // scrolls — we recompute on open and on window resize.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  useEffect(() => {
    if (!open) return
    const place = () => {
      const a = anchorRef.current
      if (!a) return
      const r = a.getBoundingClientRect()
      // Anchor to the BUTTON's left edge, drop below by 8 px. The popover
      // is 380 px wide, so clamp so it never falls off the right edge of
      // the window.
      const w = 380
      let left = r.left
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8
      if (left < 8) left = 8
      setPos({ left, top: r.bottom + 8 })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef])

  // Focus the search input on open. Doing this in an effect (not autoFocus)
  // keeps the picker from stealing focus when its parent re-renders for
  // unrelated reasons.
  useEffect(() => {
    if (open) {
      // setTimeout 0 lets the popover paint before we focus; without it
      // some browsers skip the focus when the element is just-mounted.
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open])

  // Close on click-outside / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      // Click on the anchor itself shouldn't close — the parent button is
      // what toggled the picker open in the first place.
      if (containerRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  // Fetch results when open / kind / query changes. Empty query → trending.
  // Debounced 250 ms so typing doesn't fire one request per keystroke.
  useEffect(() => {
    if (!open) return
    if (!hasGiphyKey()) {
      setError('Set VITE_GIPHY_API_KEY in .env.local to enable Giphy search.')
      setItems([])
      return
    }
    setError(null)
    const trimmed = query.trim()
    const id = ++queryIdRef.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const results = trimmed
          ? await giphySearch(kind, trimmed, 24)
          : await giphyTrending(kind, 24)
        // Stale-fetch guard: a faster later query may have already set
        // newer results; in that case drop ours on the floor.
        if (id !== queryIdRef.current) return
        setItems(results)
      } catch (err) {
        if (id !== queryIdRef.current) return
        console.error('[giphy]', err)
        setError(err instanceof Error ? err.message : String(err))
        setItems([])
      } finally {
        if (id === queryIdRef.current) setLoading(false)
      }
    }, trimmed ? 250 : 0)
    return () => clearTimeout(t)
  }, [open, kind, query])

  const placeholder = useMemo(
    () => (kind === 'stickers' ? 'Search stickers — try "thumbs up"' : 'Search GIFs — try "celebration"'),
    [kind],
  )

  const handlePick = useCallback((item: GiphyItem) => {
    onPick(item)
    onClose()
  }, [onPick, onClose])

  if (!open) return null

  return (
    <div
      className="gif-picker"
      ref={containerRef}
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Search Giphy"
    >
      <div className="gif-picker__tabs">
        {(['gifs', 'stickers'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`gif-picker__tab ${kind === k ? 'gif-picker__tab--active' : ''}`}
            onClick={() => setKind(k)}
          >
            {k === 'gifs' ? 'GIFs' : 'Stickers'}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        className="gif-picker__search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className="gif-picker__grid">
        {error ? (
          <div className="gif-picker__empty">{error}</div>
        ) : loading && items.length === 0 ? (
          <div className="gif-picker__empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="gif-picker__empty">
            {query ? `No results for "${query}"` : 'Nothing trending right now'}
          </div>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              className="gif-picker__cell"
              title={it.title}
              onClick={() => handlePick(it)}
            >
              <img
                className="gif-picker__cell-img"
                src={it.preview}
                alt={it.title}
                loading="lazy"
                draggable={false}
              />
            </button>
          ))
        )}
      </div>
      <div className="gif-picker__footer">Powered by GIPHY</div>
    </div>
  )
}
