/**
 * Estimate a video element's native frame rate by playing it briefly and
 * measuring the spacing between requestVideoFrameCallback emissions.
 *
 * rVFC fires once per decoded frame, with the original media timestamp in
 * `metadata.mediaTime`. The deltas between consecutive mediaTimes give us
 * the frame interval in seconds; reciprocal is fps.
 *
 * Returns null when:
 *   - the runtime doesn't support rVFC
 *   - the video can't be played (auto-play rejection, decode error)
 *   - we can't collect enough samples within the timeout
 *
 * On exit the function restores the element's prior currentTime / mute /
 * paused state so the live preview isn't disturbed.
 */
export async function detectVideoFps(
  el: HTMLVideoElement,
  maxSamples = 8,
  timeoutMs = 3000,
): Promise<number | null> {
  type WithRVFC = HTMLVideoElement & {
    requestVideoFrameCallback?: (
      cb: (now: number, metadata: { mediaTime: number; presentationTime: number }) => void,
    ) => number
  }
  const vid = el as WithRVFC
  if (typeof vid.requestVideoFrameCallback !== 'function') return null

  return new Promise<number | null>((resolve) => {
    // Snapshot state so we can restore. el.paused/muted/currentTime are
    // user-observable; we don't want a measurement pass to leave the live
    // preview in a different position than the user saw.
    const wasPaused = el.paused
    const wasMuted = el.muted
    const wasLoop = el.loop
    const startTime = el.currentTime

    let done = false
    const samples: number[] = []
    let lastMediaTime: number | null = null

    const restore = () => {
      try { el.pause() } catch { /* ignore */ }
      el.muted = wasMuted
      el.loop = wasLoop
      el.currentTime = startTime
      if (!wasPaused) {
        el.play().catch(() => { /* ignore restore failures */ })
      }
    }

    const finish = (fps: number | null) => {
      if (done) return
      done = true
      clearTimeout(hardTimeout)
      restore()
      resolve(fps)
    }

    const hardTimeout = setTimeout(() => finish(null), timeoutMs)

    const onFrame = (_now: number, metadata: { mediaTime: number; presentationTime: number }) => {
      if (done) return
      if (lastMediaTime !== null) {
        const dt = metadata.mediaTime - lastMediaTime
        if (dt > 0 && dt < 1) samples.push(dt)
      }
      lastMediaTime = metadata.mediaTime
      if (samples.length >= maxSamples) {
        // Median of the intervals — robust against the occasional dropped
        // frame or stutter that would skew a plain mean.
        const sorted = [...samples].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]!
        finish(median > 0 ? 1 / median : null)
        return
      }
      vid.requestVideoFrameCallback!(onFrame)
    }

    // Play silently to start producing frame callbacks.
    el.muted = true
    el.loop = false
    vid.requestVideoFrameCallback!(onFrame)
    const playPromise = el.play()
    if (playPromise) {
      playPromise.catch(() => finish(null))
    }
  })
}

/**
 * Snap a detected frame rate to its nearest standard rate when it's clearly
 * close to one. Detection has small jitter so 29.94 may come back as ~29.94;
 * we'd rather report "30" than show three decimals everywhere.
 *
 * Tolerance: ±0.5 fps. Anything outside the well-known buckets is returned
 * unrounded (with one decimal).
 */
export function roundToCommonFps(fps: number): number {
  const candidates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]
  for (const c of candidates) {
    if (Math.abs(fps - c) < 0.5) return c
  }
  return Math.round(fps * 10) / 10
}

/**
 * Decide whether two frame rates are "the same" for export purposes.
 * 29.94 and 30 should be considered equal; 30 and 60 shouldn't.
 */
export function fpsRoughlyEqual(a: number, b: number, tol = 1.0): boolean {
  return Math.abs(a - b) <= tol
}
