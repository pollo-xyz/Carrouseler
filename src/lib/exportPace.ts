/**
 * Export pacing for live media.
 *
 * Videos and GIFs run on their own clock, but capturing a frame (pose, draw,
 * read back, hand to ffmpeg) usually takes longer than a frame lasts — at
 * 60 fps it always does. Sampled in real time, that leaves gaps the export
 * can only fill by repeating frames, which plays back as a 10–20 fps stutter.
 *
 * So while exporting, that clock is slowed to a rate at which each capture
 * fits inside one frame: every output frame gets a capture of its own, and
 * the export simply takes longer. The rate follows the measured capture
 * cost; a capture that still lands late slows it further at once.
 */

/** The slowest playbackRate Chromium accepts. */
export const MIN_RATE = 0.0625

/** Margin over the measured capture cost: rAF granularity and the odd slow
 *  frame (GC, encoder hiccup) must not push a capture past its slot. */
const HEADROOM = 1.5

/** The playback rate at which a capture costing `costMs` fits in a frame of `frameMs`. */
export function fittingRate(costMs: number, frameMs: number): number {
  if (!(costMs > 0) || !(frameMs > 0)) return 1
  return Math.min(1, Math.max(MIN_RATE, frameMs / (costMs * HEADROOM)))
}

/** Next rate after a capture cost estimate: drops at once, climbs gently —
 *  so one fast frame can't send the clock racing ahead of the capture. */
export function nextRate(rate: number, costMs: number, frameMs: number): number {
  const fit = fittingRate(costMs, frameMs)
  if (fit < rate) return fit
  if (fit > rate * 1.15) return Math.min(fit, rate * 1.25)
  return rate
}

/** Rate after a capture that came `slots` frames after its own (slots > 1). */
export function rateAfterMiss(rate: number, slots: number): number {
  return Math.max(MIN_RATE, (rate / Math.max(1, slots)) * 0.8)
}

/**
 * Chromium refreshes a playing video's frame for canvas reads from its own
 * renderer. For an element that isn't in the page that renderer is a
 * fallback that only takes over after ~250 ms without on-screen frames —
 * so shortly after playback starts the picture froze for a quarter second
 * while currentTime ran on, and the export repeated one frame 6–8 times.
 * Mounted in the page (1 px, practically transparent, under the export
 * veil) the video gets real frames from the start.
 *
 * Returns the unmount, which also resumes playback: removing a media element
 * from the page pauses it, and that pause lands after the current task — a
 * play() right after the unmount would simply be undone.
 */
export function mountVideosForCapture(els: Iterable<HTMLVideoElement>): () => void {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;'
  const moved: { el: HTMLVideoElement; parent: Node | null; next: Node | null }[] = []
  for (const el of els) {
    moved.push({ el, parent: el.parentNode, next: el.nextSibling })
    host.appendChild(el)
  }
  document.body.appendChild(host)
  return () => {
    for (const { el, parent, next } of moved) {
      if (parent) parent.insertBefore(el, next)
      else el.remove()
    }
    host.remove()
    setTimeout(() => {
      for (const { el } of moved) el.play().catch(() => {})
    }, 0)
  }
}

/** Seek a video and wait for the frame to land, giving up after `timeoutMs`
 *  so one misbehaving file can't wedge an export. */
export function seekVideo(el: HTMLVideoElement, t: number, timeoutMs = 3000): Promise<void> {
  return new Promise<void>((resolve) => {
    if (Math.abs(el.currentTime - t) < 1e-4 && !el.seeking) { resolve(); return }
    const done = () => { clearTimeout(timer); el.removeEventListener('seeked', done); resolve() }
    const timer = setTimeout(done, timeoutMs)
    el.addEventListener('seeked', done)
    el.currentTime = t
  })
}

export interface ExportPace {
  /** Current media rate (1 = real time). */
  readonly rate: number
  /** Report how long one frame's capture took, in wall-clock ms. */
  record(costMs: number): void
  /** A capture landed `slots` frame slots after its own: slow down now. */
  missed(slots: number): void
  /** Put a video on the export clock (sets its playbackRate). */
  addVideo(el: HTMLVideoElement): void
  /** Take a video off the export clock (back to real time). */
  removeVideo(el: HTMLVideoElement): void
  /** Media time elapsed on the export clock, in ms. */
  mediaMs(): number
  /** Resolve once the export clock reaches `targetMs` of media time. */
  waitUntil(targetMs: number): Promise<void>
  /** Set the clock to `ms` of media time now — after a pause for seeking. */
  resync(ms: number): void
  /** Everything back to real time. */
  dispose(): void
}

export function createExportPace(
  fps: number,
  opts: {
    /** Cost of a capture measured up front; sets the starting rate. */
    initialCostMs?: number
    /** Called whenever the rate changes — GIF animators follow it. */
    onRate?: (rate: number) => void
  } = {},
): ExportPace {
  const frameMs = 1000 / fps
  const videos = new Set<HTMLVideoElement>()
  let rate = opts.initialCostMs ? fittingRate(opts.initialCostMs, frameMs) : 1
  let estimate = opts.initialCostMs ?? 0
  // The clock integrates rate over wall time; re-anchored on every change.
  let anchorWall = performance.now()
  let anchorMedia = 0

  const mediaMs = () => anchorMedia + (performance.now() - anchorWall) * rate
  const setRate = (r: number) => {
    if (r === rate) return
    anchorMedia = mediaMs()
    anchorWall = performance.now()
    rate = r
    for (const el of videos) el.playbackRate = r
    opts.onRate?.(r)
  }
  opts.onRate?.(rate)

  return {
    get rate() { return rate },
    record(costMs) {
      if (!(costMs > 0)) return
      estimate = estimate ? estimate * 0.75 + costMs * 0.25 : costMs
      setRate(nextRate(rate, estimate, frameMs))
    },
    missed(slots) {
      if (slots > 1) setRate(rateAfterMiss(rate, slots))
    },
    addVideo(el) {
      videos.add(el)
      el.playbackRate = rate
    },
    removeVideo(el) {
      videos.delete(el)
      el.playbackRate = 1
    },
    mediaMs,
    async waitUntil(targetMs) {
      const wait = (targetMs - mediaMs()) / rate
      if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait))
    },
    resync(ms) {
      anchorMedia = ms
      anchorWall = performance.now()
    },
    dispose() {
      for (const el of videos) el.playbackRate = 1
      videos.clear()
      opts.onRate?.(1)
    },
  }
}
