import { useRef, useState } from 'react'

interface Props {
  value: number
  onCommit: (n: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
  style?: React.CSSProperties
  className?: string
  title?: string
  /** Enables click-and-drag horizontal scrubbing. Number of value units per
   *  pixel of horizontal movement. e.g. `1` → 1px = +1; `0.1` → 10px = +1.
   *  Falsy / undefined → scrubbing disabled, click acts as a normal focus.
   *  Shift accelerates ×10, Alt/Option damps ÷10 during the drag. */
  scrubStep?: number
}

/**
 * Number input that only commits on blur or Enter (Escape reverts).
 *
 * Why: the previous pattern `onChange={e => setX(Number(e.target.value) || fallback)}`
 * combined with a clamping setter meant every keystroke was immediately
 * clamped — typing "1" into a min=4 field jumped to "4" before you could
 * type the rest, making values like 120 unreachable.
 */
export default function NumberField({
  value, onCommit, min, max, step, decimals, style, className, title, scrubStep,
}: Props) {
  const fmt = (v: number) => (decimals !== undefined ? v.toFixed(decimals) : String(v))
  const [text, setText] = useState<string>(() => fmt(value))
  const [focused, setFocused] = useState(false)

  // Re-sync local text whenever the source value changes (e.g. from undo,
  // a slider, or another input editing the same store field). Done as a
  // render-time state adjustment (React's sanctioned derived-state reset)
  // rather than an effect, so there's no flash of stale text.
  // Skipped while focused: the text is the user's then, and the live
  // commits below feed `value` straight back — re-formatting mid-edit
  // turned "0." into "0.00" and made "0.8" untypeable in decimal fields.
  // Blur re-syncs (commit() rewrites the text).
  const [prevSync, setPrevSync] = useState({ value, decimals })
  if (prevSync.value !== value || prevSync.decimals !== decimals) {
    setPrevSync({ value, decimals })
    if (!focused) setText(fmt(value))
  }

  // Value when the field gained focus — Escape restores it even after live
  // keystroke commits have already changed the store.
  const focusValueRef = useRef(value)
  // Set by Escape so the blur it triggers doesn't commit the typed text.
  const cancelRef = useRef(false)
  // Did the user type since focus? A blur without edits must not write
  // anything (it would re-dirty the document, or clobber a value changed
  // elsewhere while the field sat focused).
  const editedRef = useRef(false)

  // Scrub state — null when not in a drag, populated on pointerdown. The
  // `active` flag flips once the pointer has moved past a small threshold,
  // distinguishing a click-to-focus from a click-and-drag.
  const scrubRef = useRef<{
    startX: number
    startVal: number
    pointerId: number
    active: boolean
  } | null>(null)

  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    return n
  }

  const commit = () => {
    const trimmed = text.trim()
    if (!editedRef.current || !trimmed) { setText(fmt(value)); return }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) { setText(fmt(value)); return }
    let clamped = clamp(n)
    // Store what the field displays — a live-committed 0.25 in a 1-decimal
    // field would otherwise read "0.3" while the document holds 0.25.
    if (decimals !== undefined) clamped = Number(clamped.toFixed(decimals))
    // Live commits usually stored this already; skip the redundant write.
    if (clamped !== value) onCommit(clamped)
    setText(fmt(clamped))
  }

  const onFocus = () => {
    setFocused(true)
    focusValueRef.current = value
    cancelRef.current = false
    editedRef.current = false
  }

  const onBlur = () => {
    setFocused(false)
    if (cancelRef.current) {
      // Escape already restored both the text and the stored value.
      cancelRef.current = false
      return
    }
    commit()
  }

  // Live commit on every keystroke when the typed value already parses to a
  // finite number inside the allowed range. This gives real-time feedback
  // (e.g. the grid redraws while you type "120") without ever clamping mid-edit
  // — a partial value like "1" in a min=4 input is just held until you finish
  // typing or blur out.
  const onChange = (raw: string) => {
    setText(raw)
    editedRef.current = true
    const trimmed = raw.trim()
    if (!trimmed) return
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    if (min !== undefined && n < min) return
    if (max !== undefined && n > max) return
    onCommit(n)
  }

  // Drag-to-scrub handlers — only attached when scrubStep is provided.
  // Skipped when the input already has focus (so the user can still
  // mousedown-and-select inside the text without triggering a drag).
  const scrubEnabled = !!scrubStep && scrubStep > 0
  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!scrubEnabled) return
    if (e.button !== 0) return
    const el = e.currentTarget
    if (document.activeElement === el) return
    scrubRef.current = {
      startX: e.clientX,
      startVal: value,
      pointerId: e.pointerId,
      active: false,
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    const s = scrubRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const dx = e.clientX - s.startX
    if (!s.active) {
      // 4 px movement threshold to distinguish a click from a drag.
      if (Math.abs(dx) < 4) return
      s.active = true
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.style.cursor = 'ew-resize'
    }
    e.preventDefault()
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const raw = s.startVal + dx * (scrubStep ?? 1) * mult
    const next = decimals !== undefined
      ? Number(clamp(raw).toFixed(decimals))
      : Math.round(clamp(raw))
    setText(fmt(next))
    onCommit(next)
  }
  const endScrub = (e: React.PointerEvent<HTMLInputElement>) => {
    const s = scrubRef.current
    if (!s || s.pointerId !== e.pointerId) return
    if (s.active) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      document.body.style.cursor = ''
      // Suppress the trailing click+focus that would otherwise fire after the
      // drag, so a drag-to-scrub doesn't leave the field in edit mode.
      e.preventDefault()
      ;(e.currentTarget as HTMLInputElement).blur()
    }
    scrubRef.current = null
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.currentTarget as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          // Revert to the value from before this edit. Live commits may
          // already have pushed keystrokes into the store, so write the
          // original back; the cancel flag stops the blur from committing
          // the typed text over it.
          const original = focusValueRef.current
          cancelRef.current = true
          if (value !== original) onCommit(original)
          setText(fmt(original))
          ;(e.currentTarget as HTMLInputElement).blur()
        }
      }}
      onPointerDown={scrubEnabled ? onPointerDown : undefined}
      onPointerMove={scrubEnabled ? onPointerMove : undefined}
      onPointerUp={scrubEnabled ? endScrub : undefined}
      onPointerCancel={scrubEnabled ? endScrub : undefined}
      style={style}
      // The .scrubbable class hints with an ew-resize cursor when idle and
      // switches back to text cursor on :focus so typing still feels right.
      className={[className, scrubEnabled ? 'scrubbable' : null].filter(Boolean).join(' ') || undefined}
      title={title}
    />
  )
}
