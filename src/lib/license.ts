import { create } from 'zustand'

/**
 * Lemon Squeezy licensing — ported from Plaza's `license.rs`, adapted for
 * Tiovivo's split model:
 *
 *   Desktop (Electron): 14-day trial → blocking gate until a key activates.
 *   Web (browser mode): free tier, never blocks. Pro features (export, native
 *   save) are desktop-only anyway, so the web pill upsells the download.
 *
 * The License API needs no client secret — activate / validate / deactivate
 * are public endpoints designed to be called from the app. Tiovivo is a
 * subscription product: when the subscription lapses Lemon Squeezy flips the
 * key's status to "expired", which the validate call surfaces on next launch
 * (bounded by the offline grace window below).
 */

const API_BASE = 'https://api.lemonsqueezy.com/v1/licenses'

/** Same Second March store as Plaza; Tiovivo's subscription product. */
const STORE_ID = 195115
const PRODUCT_ID = 1193189
export const STORE_URL = 'https://secondmarch.lemonsqueezy.com'

const CACHE_KEY = 'tiovivo-license'
const TRIAL_KEY = 'tiovivo-trial-start'

const DAY_MS = 24 * 60 * 60 * 1000
const TRIAL_DAYS = 14
/** How long a cached "valid" verdict holds without reaching the API. */
const GRACE_MS = 14 * DAY_MS

export const isDesktop = typeof window !== 'undefined' && !!window.electronAPI

export type LicenseState = 'active' | 'trial' | 'expired' | 'unlicensed' | 'invalid'

export interface LicenseStatus {
  state: LicenseState
  email: string | null
  /** True when we're inside the grace window but haven't verified today. */
  offline: boolean
  message: string | null
  trialDaysLeft: number | null
}

interface LicenseCache {
  key: string
  /** Lemon Squeezy instance id binding the key to this install. Empty when
   *  the seat limit was reached and we fell back to key-only validation. */
  instanceId: string
  email: string | null
  lastValidatedMs: number
}

/* ── storage ─────────────────────────────────────────────────────── */

function readCache(): LicenseCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as LicenseCache
    return typeof c.key === 'string' && typeof c.lastValidatedMs === 'number' ? c : null
  } catch {
    return null
  }
}

function writeCache(c: LicenseCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    /* storage full/blocked — grace window just won't survive a restart */
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/* ── trial (desktop only) ────────────────────────────────────────── */

function trialStatus(): LicenseStatus {
  let started: number
  try {
    const raw = localStorage.getItem(TRIAL_KEY)
    started = raw ? Number(raw) : NaN
    if (!Number.isFinite(started)) {
      started = Date.now()
      localStorage.setItem(TRIAL_KEY, String(started))
    }
  } catch {
    started = Date.now()
  }
  const daysLeft = TRIAL_DAYS - Math.floor((Date.now() - started) / DAY_MS)
  if (daysLeft > 0) {
    return { state: 'trial', email: null, offline: false, message: null, trialDaysLeft: daysLeft }
  }
  return {
    state: 'expired',
    email: null,
    offline: false,
    message: 'Your trial has wrapped up.',
    trialDaysLeft: 0,
  }
}

/* ── status helpers ──────────────────────────────────────────────── */

function activeStatus(email: string | null, offline: boolean): LicenseStatus {
  return { state: 'active', email, offline, message: null, trialDaysLeft: null }
}

function invalidStatus(message: string): LicenseStatus {
  return { state: 'invalid', email: null, offline: false, message, trialDaysLeft: null }
}

const UNLICENSED: LicenseStatus = {
  state: 'unlicensed',
  email: null,
  offline: false,
  message: null,
  trialDaysLeft: null,
}

/** Synchronous status from cache — never touches the network. */
export function licenseStatus(): LicenseStatus {
  const cache = readCache()
  if (cache) {
    const age = Date.now() - cache.lastValidatedMs
    if (age <= GRACE_MS) return activeStatus(cache.email, age > DAY_MS)
    return invalidStatus('Please reconnect to the internet to verify your subscription.')
  }
  return isDesktop ? trialStatus() : UNLICENSED
}

/* ── Lemon Squeezy License API ───────────────────────────────────── */

interface LsResp {
  activated?: boolean
  valid?: boolean
  error?: string | null
  license_key?: { status?: string }
  instance?: { id?: string }
  meta?: { store_id?: number; product_id?: number; customer_email?: string }
}

async function lsPost(endpoint: string, form: Record<string, string>): Promise<LsResp> {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams(form),
  })
  return (await resp.json()) as LsResp
}

function wrongProduct(body: LsResp): boolean {
  const m = body.meta
  if (!m) return false
  return (m.store_id != null && m.store_id !== STORE_ID)
    || (m.product_id != null && m.product_id !== PRODUCT_ID)
}

function keyDead(body: LsResp): boolean {
  const s = body.license_key?.status
  return s === 'expired' || s === 'disabled'
}

function instanceName(): string {
  const p = typeof navigator !== 'undefined' ? navigator.platform || 'device' : 'device'
  return `Tiovivo · ${isDesktop ? 'desktop' : 'web'} · ${p}`
}

/** Seat-limit fallback: validate the key without binding an instance. */
async function validateKeyOnly(key: string): Promise<LicenseStatus | null> {
  const body = await lsPost('validate', { license_key: key })
  if (body.valid !== true || keyDead(body) || wrongProduct(body)) return null
  writeCache({
    key,
    instanceId: '',
    email: body.meta?.customer_email ?? null,
    lastValidatedMs: Date.now(),
  })
  return activeStatus(body.meta?.customer_email ?? null, false)
}

export async function licenseActivate(key: string): Promise<LicenseStatus> {
  let body: LsResp
  try {
    body = await lsPost('activate', { license_key: key, instance_name: instanceName() })
  } catch {
    return invalidStatus("Couldn't reach the license server — check your connection and try again.")
  }

  if (wrongProduct(body)) {
    return invalidStatus('That key belongs to a different product.')
  }

  if (body.activated === true && !keyDead(body)) {
    writeCache({
      key,
      instanceId: body.instance?.id ?? '',
      email: body.meta?.customer_email ?? null,
      lastValidatedMs: Date.now(),
    })
    return activeStatus(body.meta?.customer_email ?? null, false)
  }

  // Activation limit reached (or similar) — the key itself may still be
  // perfectly valid. Fall back to a key-only validation.
  try {
    const fallback = await validateKeyOnly(key)
    if (fallback) return fallback
  } catch {
    /* fall through to the server's message */
  }

  return invalidStatus(body.error || "That key didn't work — double-check it and try again.")
}

/** Background revalidation — call once per launch when a cache exists. */
export async function licenseRefresh(): Promise<LicenseStatus> {
  const cache = readCache()
  if (!cache) return licenseStatus()

  let body: LsResp
  try {
    const form: Record<string, string> = { license_key: cache.key }
    if (cache.instanceId) form.instance_id = cache.instanceId
    body = await lsPost('validate', form)
  } catch {
    // Offline — fall back to the grace window.
    return licenseStatus()
  }

  const hardInvalid = body.valid === false || keyDead(body) || wrongProduct(body)
  if (hardInvalid) {
    clearCache()
    return invalidStatus(body.error || 'Your subscription has ended. Renew it to keep exporting.')
  }

  const updated: LicenseCache = {
    ...cache,
    email: body.meta?.customer_email ?? cache.email,
    lastValidatedMs: Date.now(),
  }
  writeCache(updated)
  return activeStatus(updated.email, false)
}

/** Frees the seat so the key can activate elsewhere. Local cache is always
 *  cleared, even when the network call fails (matches Plaza). */
export async function licenseDeactivate(): Promise<LicenseStatus> {
  const cache = readCache()
  if (cache && cache.instanceId) {
    try {
      await lsPost('deactivate', { license_key: cache.key, instance_id: cache.instanceId })
    } catch {
      /* best effort */
    }
  }
  clearCache()
  return licenseStatus()
}

/* ── reactive store ──────────────────────────────────────────────── */

interface LicenseStoreState {
  status: LicenseStatus
  busy: boolean
  activate: (key: string) => Promise<LicenseStatus>
  deactivate: () => Promise<void>
}

export const useLicenseStore = create<LicenseStoreState>((set) => ({
  status: licenseStatus(),
  busy: false,
  activate: async (key: string) => {
    set({ busy: true })
    try {
      const s = await licenseActivate(key)
      if (s.state === 'active') set({ status: s })
      return s
    } finally {
      set({ busy: false })
    }
  },
  deactivate: async () => {
    set({ busy: true })
    try {
      const s = await licenseDeactivate()
      set({ status: s })
    } finally {
      set({ busy: false })
    }
  },
}))

/** Whether paid functionality is unlocked right now. On desktop the trial
 *  counts; on web only a real key does (the free tier gates pro features). */
export function isPro(status: LicenseStatus): boolean {
  return status.state === 'active' || (isDesktop && status.state === 'trial')
}

let refreshed = false

/** Apply the cached status and revalidate once in the background.
 *  Call from main.tsx before first paint. */
export function initLicense() {
  const status = licenseStatus()
  useLicenseStore.setState({ status })
  if (!refreshed && readCache()) {
    refreshed = true
    void licenseRefresh().then((s) => useLicenseStore.setState({ status: s }))
  }
}
