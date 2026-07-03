import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  STORE_URL,
  isDesktop,
  useLicenseStore,
  type LicenseStatus,
} from '../lib/license'
import { toast } from '../lib/feedback'

/**
 * Licensing UI, three pieces:
 *
 *  <LicensePill/>  — header chip. Trial countdown on desktop, "Upgrade" on
 *                    the free web tier, a quiet "Pro" chip when licensed.
 *                    Always opens the license dialog.
 *  license dialog  — activation / subscription info / deactivation.
 *  <LicenseGate/>  — desktop-only blocking overlay once the trial is over
 *                    (or a key turns invalid). Web never blocks.
 */

function openCheckout() {
  window.open(STORE_URL, '_blank', 'noopener')
}

/* ── Activation form (shared by dialog + gate) ───────────────────── */

function ActivationForm({ onActivated }: { onActivated?: () => void }) {
  const activate = useLicenseStore((s) => s.activate)
  const busy = useLicenseStore((s) => s.busy)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    const trimmed = key.trim()
    if (busy || !trimmed) return
    setError(null)
    const s: LicenseStatus = await activate(trimmed)
    if (s.state === 'active') {
      toast('Subscription activated — thanks for supporting Tiovivo!', { kind: 'success' })
      onActivated?.()
    } else {
      setError(s.message ?? "That key didn't work — double-check it and try again.")
    }
  }, [activate, busy, key, onActivated])

  return (
    <form
      className="license__form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        className="license__input"
        type="text"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
        spellCheck={false}
        autoComplete="off"
      />
      {error && (
        <div className="license__error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" className="btn btn--export license__activate" disabled={busy || !key.trim()}>
        {busy ? 'Checking…' : 'Activate'}
      </button>
      <div className="license__foot">
        No key yet?{' '}
        <button type="button" className="license__link" onClick={openCheckout}>
          Get a subscription
        </button>
      </div>
    </form>
  )
}

/* ── Dialog ──────────────────────────────────────────────────────── */

function LicenseDialog({ onClose }: { onClose: () => void }) {
  const status = useLicenseStore((s) => s.status)
  const deactivate = useLicenseStore((s) => s.deactivate)
  const busy = useLicenseStore((s) => s.busy)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const licensed = status.state === 'active'

  // Portal to <body>: the pill lives inside the header, whose backdrop-filter
  // creates a stacking context that would otherwise trap this fixed overlay
  // beneath the canvas.
  return createPortal(
    <div className="confirm__backdrop" onClick={onClose}>
      <div
        className="confirm license"
        role="dialog"
        aria-modal="true"
        aria-label="Tiovivo license"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm__title">
          {licensed
            ? 'Tiovivo Pro'
            : status.state === 'trial'
              ? `Trial — ${status.trialDaysLeft} ${status.trialDaysLeft === 1 ? 'day' : 'days'} left`
              : 'Upgrade to Tiovivo Pro'}
        </div>

        {licensed ? (
          <>
            <p className="license__copy">
              Subscribed{status.email ? <> as <strong>{status.email}</strong></> : null}.
              {status.offline ? ' Verified offline — will re-check when you reconnect.' : ''}
            </p>
            <div className="confirm__actions">
              <button type="button" className="confirm__btn" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="confirm__btn confirm__btn--danger"
                disabled={busy}
                onClick={() => {
                  void deactivate().then(() =>
                    toast('This device was deactivated — the seat is free for another machine.'),
                  )
                }}
              >
                {busy ? 'Deactivating…' : 'Deactivate this device'}
              </button>
            </div>
            <p className="hint">Frees the seat so you can activate the key on another machine.</p>
          </>
        ) : (
          <>
            <p className="license__copy">
              {isDesktop
                ? 'A subscription unlocks Tiovivo beyond the trial — unlimited projects, PNG + hardware-encoded MP4 export, and every update while you’re subscribed.'
                : 'The web editor is free to design in. A subscription unlocks the desktop app: PNG + hardware-encoded MP4 export, .vpost project files, and system fonts.'}
            </p>
            <p className="license__copy license__copy--dim">
              Paste the license key from your purchase email:
            </p>
            <ActivationForm onActivated={onClose} />
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Header pill ─────────────────────────────────────────────────── */

export function LicensePill() {
  const status = useLicenseStore((s) => s.status)
  const [open, setOpen] = useState(false)

  let label: string
  let cls = ''
  if (status.state === 'active') {
    label = 'Pro'
    cls = 'license-pill--pro'
  } else if (status.state === 'trial') {
    label = `Trial · ${status.trialDaysLeft}d`
    cls = 'license-pill--trial'
  } else {
    label = 'Upgrade'
    cls = 'license-pill--upgrade'
  }

  return (
    <>
      <button
        type="button"
        className={`license-pill ${cls}`}
        onClick={() => setOpen(true)}
        title={
          status.state === 'active'
            ? 'Manage your Tiovivo subscription'
            : 'Unlock Tiovivo Pro'
        }
      >
        {label}
      </button>
      {open && <LicenseDialog onClose={() => setOpen(false)} />}
    </>
  )
}

/* ── Blocking gate (desktop, trial over / key invalid) ───────────── */

export function LicenseGate() {
  const status = useLicenseStore((s) => s.status)

  // Web never blocks; desktop blocks only once there's no trial left.
  if (!isDesktop) return null
  if (status.state !== 'expired' && status.state !== 'invalid') return null

  const heading =
    status.state === 'expired' ? 'Your trial has wrapped up' : 'Let’s sort out your key'
  const sub =
    status.state === 'expired'
      ? 'Enter a license key to pick up right where you left off — your projects are safe and untouched.'
      : status.message ?? 'Your key could not be verified.'

  return (
    <div className="license-gate">
      <div className="confirm license" role="dialog" aria-modal="true" aria-label="Activate Tiovivo">
        <div className="license__brand">Tiovivo</div>
        <div className="confirm__title">{heading}</div>
        <p className="license__copy">{sub}</p>
        <ActivationForm />
      </div>
    </div>
  )
}
