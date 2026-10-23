import { create } from 'zustand'

/**
 * In-app replacement for alert() / window.confirm().
 *
 * - toast(message, opts) — non-blocking notification, stacks bottom-right.
 * - confirmDialog(opts)  — promise-based modal confirm; resolves true/false.
 * - choiceDialog(opts)   — same modal with an optional third button
 *                          (Save / Don't Save / Cancel); resolves the choice.
 *
 * State lives in a small zustand store; <ToastHost/> and <ConfirmHost/>
 * (src/components/FeedbackHosts.tsx) render it.
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  /** 0 = sticky until manually dismissed. */
  duration: number
  /** Exit phase — the host keeps rendering it while the CSS transition
   *  plays, then dismissToast's timer removes it for real. */
  leaving?: boolean
}

/** Which button closed the dialog. Escape / veil click count as 'cancel'. */
export type ConfirmChoice = 'confirm' | 'alt' | 'cancel'

export interface ConfirmRequest {
  title?: string
  message: string
  confirmLabel: string
  cancelLabel: string
  /** Optional secondary action shown apart from Cancel / confirm (e.g.
   *  "Don't Save"); choosing it resolves 'alt'. */
  altLabel?: string
  /** Styles the confirm button as destructive (and focuses Cancel first so
   *  a stray Enter can't destroy anything). */
  danger: boolean
  resolve: (choice: ConfirmChoice) => void
}

interface FeedbackState {
  toasts: ToastItem[]
  confirm: ConfirmRequest | null
}

export const useFeedbackStore = create<FeedbackState>(() => ({
  toasts: [],
  confirm: null,
}))

let nextToastId = 1
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()

/** How long the .toast--leaving CSS transition runs (see App.css). */
const TOAST_EXIT_MS = 300

export function dismissToast(id: number) {
  const timer = toastTimers.get(id)
  if (timer) clearTimeout(timer)
  toastTimers.delete(id)
  const current = useFeedbackStore.getState().toasts.find((t) => t.id === id)
  if (!current || current.leaving) return
  // Two-phase exit: mark it leaving so the slide-away transition plays,
  // then drop it once the motion has finished.
  useFeedbackStore.setState((s) => ({
    toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
  }))
  setTimeout(() => {
    useFeedbackStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }, TOAST_EXIT_MS)
}

export function toast(
  message: string,
  opts?: { kind?: ToastKind; duration?: number },
): number {
  const kind = opts?.kind ?? 'info'
  // Errors linger longer so there's time to actually read them.
  const duration = opts?.duration ?? (kind === 'error' ? 9000 : 4500)
  const id = nextToastId++
  useFeedbackStore.setState((s) => ({
    // Cap the stack; oldest drops first.
    toasts: [...s.toasts.slice(-4), { id, kind, message, duration }],
  }))
  if (duration > 0) {
    toastTimers.set(id, setTimeout(() => dismissToast(id), duration))
  }
  return id
}

interface DialogOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export function choiceDialog(opts: DialogOptions & { altLabel?: string }): Promise<ConfirmChoice> {
  return new Promise<ConfirmChoice>((resolve) => {
    // Only one dialog at a time; a second request cancels the first.
    useFeedbackStore.getState().confirm?.resolve('cancel')
    useFeedbackStore.setState({
      confirm: {
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        altLabel: opts.altLabel,
        danger: opts.danger ?? false,
        resolve: (choice) => {
          useFeedbackStore.setState({ confirm: null })
          resolve(choice)
        },
      },
    })
  })
}

export function confirmDialog(opts: DialogOptions): Promise<boolean> {
  return choiceDialog(opts).then((choice) => choice === 'confirm')
}
