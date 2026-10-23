import { useEffect, useRef } from 'react'
import { useFeedbackStore, dismissToast } from '../lib/feedback'

/* ------------------------------------------------------------------ */
/*  ToastHost — bottom-right notification stack                       */
/* ------------------------------------------------------------------ */

const KIND_ICON = { info: 'ℹ', success: '✓', error: '✕' } as const

export function ToastHost() {
  const toasts = useFeedbackStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}${t.leaving ? ' toast--leaving' : ''}`}>
          <span className="toast__icon" aria-hidden>{KIND_ICON[t.kind]}</span>
          <span className="toast__msg">{t.message}</span>
          <button
            className="toast__close"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ConfirmHost — modal promise-based confirm dialog                  */
/* ------------------------------------------------------------------ */

export function ConfirmHost() {
  const confirm = useFeedbackStore((s) => s.confirm)
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  // Focus a button so Enter / Escape work without the mouse — the primary
  // action normally, but Cancel for destructive dialogs so a stray Enter
  // can't destroy anything. On close, hand focus back to whatever had it.
  useEffect(() => {
    if (!confirm) return
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(confirm.danger ? cancelBtnRef : confirmBtnRef).current?.focus()
    return () => {
      if (prev?.isConnected) prev.focus()
    }
  }, [confirm])

  if (!confirm) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Modal: no keystroke may reach the window-level canvas shortcuts
    // behind the veil (Backspace deleting items, Space panning, …).
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      confirm.resolve('cancel')
    } else if (e.key === 'Tab') {
      // Trap Tab inside the dialog's buttons.
      const btns = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      if (btns.length === 0) return
      const i = btns.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.shiftKey
        ? btns[i <= 0 ? btns.length - 1 : i - 1]
        : btns[i < 0 || i === btns.length - 1 ? 0 : i + 1]
      e.preventDefault()
      next?.focus()
    }
  }

  return (
    <div
      className="confirm__backdrop"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Click on the veil (not the panel) cancels.
        if (e.target === e.currentTarget) confirm.resolve('cancel')
      }}
    >
      <div
        ref={panelRef}
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={confirm.title ?? 'Confirm'}
      >
        {confirm.title && <div className="confirm__title">{confirm.title}</div>}
        <div className="confirm__message">{confirm.message}</div>
        <div className="confirm__actions">
          {confirm.altLabel && (
            // Secondary choice (e.g. "Don't Save") sits apart on the left,
            // macOS-style, so it isn't mistaken for Cancel.
            <button
              className="confirm__btn"
              style={{ marginRight: 'auto' }}
              onClick={() => confirm.resolve('alt')}
            >
              {confirm.altLabel}
            </button>
          )}
          <button ref={cancelBtnRef} className="confirm__btn" onClick={() => confirm.resolve('cancel')}>
            {confirm.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm__btn confirm__btn--primary${confirm.danger ? ' confirm__btn--danger' : ''}`}
            onClick={() => confirm.resolve('confirm')}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
