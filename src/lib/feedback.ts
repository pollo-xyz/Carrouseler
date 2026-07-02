import { create } from 'zustand'

/**
 * In-app replacement for alert() / window.confirm().
 *
 * - toast(message, opts) — non-blocking notification, stacks bottom-right.
 * - confirmDialog(opts)  — promise-based modal confirm; resolves true/false.
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
}

export interface ConfirmRequest {
  title?: string
  message: string
  confirmLabel: string
  cancelLabel: string
  /** Styles the confirm button as destructive. */
  danger: boolean
  resolve: (accepted: boolean) => void
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

export function dismissToast(id: number) {
  const timer = toastTimers.get(id)
  if (timer) clearTimeout(timer)
  toastTimers.delete(id)
  useFeedbackStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
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

export function confirmDialog(opts: {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Only one dialog at a time; a second request cancels the first.
    useFeedbackStore.getState().confirm?.resolve(false)
    useFeedbackStore.setState({
      confirm: {
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        resolve: (accepted) => {
          useFeedbackStore.setState({ confirm: null })
          resolve(accepted)
        },
      },
    })
  })
}
