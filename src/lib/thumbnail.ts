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
        if (item.type === 'text') {
          const bold = !!item.bold
          const italic = !!item.italic
          const fontStyle =
            bold && italic ? 'italic bold' : bold ? 'bold' : italic ? 'italic' : 'normal'
          // In fill mode, fit the font to the (width, height) of the box at
          // slide-space, then scale the result by ratio so the thumbnail
          // matches what's drawn in the editor.
          let baseFontSize: number
          if (item.fillMode) {
            const measure = (size: number) => {
              const n = new Konva.Text({
                text: item.text || '',
                fontFamily: item.fontFamily || 'Inter',
                fontSize: size,
                fontStyle,
                lineHeight: item.lineHeight || 1.15,
                letterSpacing: item.letterSpacing || 0,
                width: item.width,
                wrap: 'word',
              })
              const h = n.height()
              n.destroy()
              return h
            }
            let lo = 4, hi = 4000
            for (let k = 0; k < 14; k++) {
              const mid = (lo + hi) / 2
              const h = measure(mid)
              if (h <= 0 || h > item.height) hi = mid
              else lo = mid
            }
            baseFontSize = Math.max(4, Math.floor(lo))
          } else {
            baseFontSize = item.fontSize || 64
          }
          layer.add(
            new Konva.Text({
              x: item.x * ratio,
              y: item.y * ratio,
              width: item.width * ratio,
              height: item.fillMode ? item.height * ratio : undefined,
              rotation: item.rotation,
              text: item.text || '',
              fontFamily: item.fontFamily || 'Inter',
              fontSize: Math.max(1, baseFontSize * ratio),
              fontStyle,
              fill: item.textColor || '#ffffff',
              align: item.textAlign || 'left',
              lineHeight: item.lineHeight || 1.15,
              letterSpacing: (item.letterSpacing || 0) * ratio,
              wrap: 'word',
            }),
          )
          resolve()
          return
        }
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
