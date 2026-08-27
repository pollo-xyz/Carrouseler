import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Styled tooltips for the whole app, with zero call-site changes.
 *
 * Every control already carries a native `title` attribute. On hover this
 * host lifts the title into `data-tip` (so the browser's default tooltip
 * never appears), waits the classic 350ms, then shows a styled .tip-bubble
 * anchored above the control — below it when there's no headroom.
 *
 * Accessibility: controls whose only accessible name was the title (icon
 * buttons) get an aria-label backfilled at capture time, so lifting the
 * attribute never silences a screen reader.
 *
 * React keeps ownership of the attribute: if a render changes the title
 * prop, React writes the new value and the next hover re-captures it
 * (title is read before the stashed data-tip for exactly that reason).
 */

const OPEN_DELAY_MS = 350
/** After a tip was visible, neighbouring tips open almost instantly. */
const WARM_DELAY_MS = 90
const WARM_WINDOW_MS = 400

interface TipState {
  text: string
  /** Anchor rect, captured at show time — final position is computed after
   *  the bubble has rendered and can be measured. */
  anchor: { left: number; right: number; top: number; bottom: number; cx: number; cy: number }
}

export function TipHost() {
  const [tip, setTip] = useState<TipState | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let anchor: HTMLElement | null = null
    let lastShownAt = 0
    let shown = false

    const hide = () => {
      if (timer) clearTimeout(timer)
      timer = null
      anchor = null
      if (shown) lastShownAt = Date.now()
      shown = false
      setTip((t) => (t ? null : t))
    }

    const show = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect()
      // Element vanished (menu closed, item removed) — nothing to anchor to.
      if (r.width === 0 && r.height === 0) return
      shown = true
      setTip({
        text,
        anchor: {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        },
      })
    }

    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null
      if (el === anchor) return
      hide()
      if (!el) return
      // A fresh React render restores `title` with the current text, so it
      // wins over any stale stash from a previous hover.
      const title = el.getAttribute('title')
      const text = title || el.dataset.tip || ''
      if (!text.trim()) return
      if (title) {
        el.dataset.tip = title
        el.removeAttribute('title')
        // Icon-only controls often rely on title for their accessible name.
        if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) {
          el.setAttribute('aria-label', title)
        }
      }
      anchor = el
      const warm = Date.now() - lastShownAt < WARM_WINDOW_MS
      timer = setTimeout(() => show(el, text), warm ? WARM_DELAY_MS : OPEN_DELAY_MS)
    }

    const onOut = (e: PointerEvent) => {
      if (!anchor) return
      const to = e.relatedTarget as Element | null
      if (to && anchor.contains(to)) return
      hide()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    // Any press, scroll or key means the user has moved on.
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    document.addEventListener('keydown', hide, true)
    return () => {
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('wheel', hide, { capture: true } as EventListenerOptions)
      document.removeEventListener('keydown', hide, true)
      if (timer) clearTimeout(timer)
    }
  }, [])

  return tip ? <TipBubble key={tip.text + tip.anchor.cx} tip={tip} /> : null
}

const GAP = 7
const EDGE = 8

/** Measured, viewport-aware placement: prefers above the anchor; anchors
 *  hugging the window's left/right edge (the canvas tool rail) get the tip
 *  BESIDE them instead, and every placement is clamped inside the window —
 *  fixes tips clipping off-screen. Measurement happens in a layout effect,
 *  so the first painted frame is already in its final spot. */
function TipBubble({ tip }: { tip: TipState }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; place: string } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const a = tip.anchor
    let place: 'top' | 'bottom' | 'right' | 'left'
    if (a.left < 90) place = 'right'
    else if (a.right > vw - 90) place = 'left'
    else place = a.top > h + GAP + EDGE ? 'top' : 'bottom'

    let left: number
    let top: number
    if (place === 'right' || place === 'left') {
      left = place === 'right' ? a.right + GAP : a.left - GAP - w
      top = a.cy - h / 2
    } else {
      left = a.cx - w / 2
      top = place === 'top' ? a.top - GAP - h : a.bottom + GAP
    }
    left = Math.min(Math.max(left, EDGE), vw - w - EDGE)
    top = Math.min(Math.max(top, EDGE), vh - h - EDGE)
    setPos({ left, top, place })
  }, [tip])

  return (
    <div
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        zIndex: 700,
        pointerEvents: 'none',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div ref={ref} className="tip-bubble" data-place={pos?.place ?? 'top'} role="tooltip">
        {tip.text}
      </div>
    </div>
  )
}
