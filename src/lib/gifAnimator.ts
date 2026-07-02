/**
 * Manually-driven GIF animator. We decode every frame ahead of time via
 * the WebCodecs `ImageDecoder` API and tick through them on the GIF's own
 * per-frame delays, writing each into a backing canvas. Konva can use the
 * canvas as its image source (same interface as HTMLImageElement) and
 * picks up whatever frame is currently painted there at draw time.
 *
 * Why not rely on the browser's native GIF playback? Chromium throttles
 * frame advancement for HTMLImageElements that aren't actually painted
 * to the screen — and Konva's source `<img>` is offscreen by design.
 * Every CSS-visibility workaround we tried got throttled anyway. Manual
 * decoding sidesteps all of that.
 */

interface DecodedFrame {
  /** A VideoFrame (closeable) holding the decoded pixels for this frame. */
  image: { close?: () => void; codedWidth?: number; codedHeight?: number; displayWidth?: number; displayHeight?: number }
  /** Per-frame display delay in milliseconds. */
  durationMs: number
}

export interface GifAnimator {
  /** The backing canvas to hand to Konva.Image as its `image` prop. */
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** Stop the playback timer and release decoded frame memory. */
  stop: () => void
}

interface ImageDecoderLike {
  new(init: { data: ArrayBuffer; type: string }): {
    completed: Promise<void>
    decode: (opts: { frameIndex: number }) => Promise<{ image: DecodedFrame['image'] & { duration?: number } }>
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
    close: () => void
  }
}

export function hasImageDecoder(): boolean {
  return typeof (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder !== 'undefined'
}

/**
 * Decode a GIF (by URL — typically a `blob:` URL) into an animated canvas.
 * Returns `null` when ImageDecoder isn't available or decoding fails, so
 * the caller can fall back to a plain `<img>` source.
 */
export async function createGifAnimator(blobUrl: string): Promise<GifAnimator | null> {
  if (!hasImageDecoder()) return null
  const Ctor = (globalThis as unknown as { ImageDecoder?: ImageDecoderLike }).ImageDecoder
  if (!Ctor) return null

  let decoder: InstanceType<ImageDecoderLike> | null = null
  try {
    const res = await fetch(blobUrl)
    if (!res.ok) return null
    const data = await res.arrayBuffer()
    decoder = new Ctor({ data, type: 'image/gif' })
    // `tracks.ready` resolves once the metadata (frame count, dimensions,
    // duration) has been parsed. `decoder.completed` is a different beast
    // — it resolves only after every frame has been pulled, which is not
    // what we want at metadata-time.
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    const frameCount = track?.frameCount ?? 0
    if (!frameCount) {
      console.warn('[gif] decoder produced 0 frames')
      return null
    }

    // Eager-decode every frame upfront. Simpler than on-demand timing, and
    // GIFs are small enough that the memory hit is fine for the carousel
    // use case (a 480×270 50-frame GIF is ~26 MB of decoded RGBA).
    const frames: DecodedFrame[] = []
    for (let i = 0; i < frameCount; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      const f = image as DecodedFrame['image'] & { duration?: number }
      // VideoFrame.duration is in microseconds. GIFs typically encode
      // 100 ms per frame (10 fps); we floor to 20 ms to avoid pathological
      // 0-duration frames spinning the event loop.
      const durationMs = Math.max(20, Math.round((f.duration ?? 100_000) / 1000))
      frames.push({ image: f, durationMs })
    }

    const first = frames[0]!.image
    const width = first.codedWidth ?? first.displayWidth ?? 480
    const height = first.codedHeight ?? first.displayHeight ?? 270
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      // No 2d context — pretend decode failed so the caller falls back.
      for (const f of frames) try { f.image.close?.() } catch { /* ignore */ }
      return null
    }

    let frameIdx = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const tick = () => {
      if (stopped) return
      const frame = frames[frameIdx]
      if (!frame) return
      ctx.clearRect(0, 0, width, height)
      // VideoFrame implements the CanvasImageSource interface — `drawImage`
      // accepts it directly.
      try { ctx.drawImage(frame.image as unknown as CanvasImageSource, 0, 0, width, height) } catch (err) {
        console.warn('[gif] drawImage failed:', err)
      }
      frameIdx = (frameIdx + 1) % frames.length
      timer = setTimeout(tick, frame.durationMs)
    }
    tick()

    return {
      canvas,
      width,
      height,
      stop: () => {
        stopped = true
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        for (const f of frames) {
          try { f.image.close?.() } catch { /* ignore */ }
        }
        try { decoder?.close() } catch { /* ignore */ }
      },
    }
  } catch (err) {
    console.warn('[gif] decode failed, falling back to <img>:', err)
    try { decoder?.close() } catch { /* ignore */ }
    return null
  }
}
