import Konva from 'konva'
import type { PlacedMedia } from '../store/useCarouselStore'
import type { Size } from './presets'

/**
 * Generate a small thumbnail data-URL for a slide by rendering its items
 * into an offscreen Konva stage.
 *
 * Returns a base-64 PNG data URL, or an empty string on failure.
 */
export async function generateThumbnail(
  items: PlacedMedia[],
  dimensions: Size,
  maxThumbWidth = 120,
  maxThumbHeight = 150,
): Promise<string> {
  if (dimensions.width <= 0 || dimensions.height <= 0) return ''

  const ratio = Math.min(
    maxThumbWidth / dimensions.width,
    maxThumbHeight / dimensions.height,
  )

  const thumbW = Math.round(dimensions.width * ratio)
  const thumbH = Math.round(dimensions.height * ratio)

  // Create a temporary container (offscreen)
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '-9999px'
  document.body.appendChild(container)

  const stage = new Konva.Stage({
    container,
    width: thumbW,
    height: thumbH,
  })

  const layer = new Konva.Layer()
  stage.add(layer)

  // Background
  layer.add(
    new Konva.Rect({
      x: 0,
      y: 0,
      width: thumbW,
      height: thumbH,
      fill: '#1a1a1f',
    }),
  )

  // Load and draw each media item
  const loadPromises = items.map(
    (item) =>
      new Promise<void>((resolve) => {
        if (item.type === 'video') {
          const v = document.createElement('video')
          v.src = item.src
          v.muted = true
          v.preload = 'auto'
          v.currentTime = 0.1 // grab a frame slightly in
          const onLoaded = () => {
            layer.add(
              new Konva.Image({
                image: v,
                x: item.x * ratio,
                y: item.y * ratio,
                width: item.width * ratio,
                height: item.height * ratio,
                rotation: item.rotation,
              }),
            )
            v.removeEventListener('seeked', onLoaded)
            resolve()
          }
          v.addEventListener('seeked', onLoaded)
          v.addEventListener('error', () => resolve())
          // trigger load
          v.load()
          return
        }

        // Image or GIF
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          layer.add(
            new Konva.Image({
              image: img,
              x: item.x * ratio,
              y: item.y * ratio,
              width: item.width * ratio,
              height: item.height * ratio,
              rotation: item.rotation,
            }),
          )
          resolve()
        }
        img.onerror = () => resolve()
        img.src = item.src
      }),
  )

  await Promise.all(loadPromises)
  layer.batchDraw()

  const dataUrl = stage.toDataURL({ pixelRatio: 1 })

  // Cleanup
  stage.destroy()
  document.body.removeChild(container)

  return dataUrl
}
