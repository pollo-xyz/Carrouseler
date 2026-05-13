import { useEffect, useState } from 'react'

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
  value, onCommit, min, max, step, decimals, style, className, title,
}: Props) {
  const fmt = (v: number) => (decimals !== undefined ? v.toFixed(decimals) : String(v))
  const [text, setText] = useState<string>(() => fmt(value))

  // Re-sync local text whenever the source value changes (e.g. from undo,
  // a slider, or another input editing the same store field).
  useEffect(() => { setText(fmt(value)) }, [value, decimals])

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
      style={style}
      className={className}
      title={title}
    />
  )
}
