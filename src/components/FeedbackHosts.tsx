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
        <div key={t.id} className={`toast toast--${t.kind}`}>
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
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  // Focus the primary action so Enter confirms and Escape cancels without
  // the user reaching for the mouse.
  useEffect(() => {
    if (confirm) confirmBtnRef.current?.focus()
  }, [confirm])

  if (!confirm) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      confirm.resolve(false)
    }
  }

  return (
    <div
      className="confirm__backdrop"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // Click on the veil (not the panel) cancels.
        if (e.target === e.currentTarget) confirm.resolve(false)
      }}
    >
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={confirm.title ?? 'Confirm'}>
        {confirm.title && <div className="confirm__title">{confirm.title}</div>}
        <div className="confirm__message">{confirm.message}</div>
        <div className="confirm__actions">
          <button className="confirm__btn" onClick={() => confirm.resolve(false)}>
            {confirm.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm__btn confirm__btn--primary${confirm.danger ? ' confirm__btn--danger' : ''}`}
            onClick={() => confirm.resolve(true)}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
