import { useEffect, useRef, useState } from 'react'

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

  // Re-sync local text whenever the source value changes (e.g. from undo,
  // a slider, or another input editing the same store field).
  useEffect(() => { setText(fmt(value)) }, [value, decimals])

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
    if (!trimmed) { setText(fmt(value)); return }
    const n = Number(trimmed)
    if (!Number.isFinite(n)) { setText(fmt(value)); return }
    let clamped = n
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    onCommit(clamped)
    setText(fmt(clamped))
  }

  // Live commit on every keystroke when the typed value already parses to a
  // finite number inside the allowed range. This gives real-time feedback
  // (e.g. the grid redraws while you type "120") without ever clamping mid-edit
  // — a partial value like "1" in a min=4 input is just held until you finish
  // typing or blur out.
  const onChange = (raw: string) => {
    setText(raw)
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
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.currentTarget as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          setText(fmt(value))
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
