import { useEffect, useRef, useState } from 'react'
import { BrandKitEditor } from './Brand'
import { useBrandStore } from '../lib/brand'
import { TEMPLATES } from '../lib/templates'
import type { Template, TemplateDeck } from '../lib/templates'
import { generateThumbnail } from '../lib/thumbnail'
import { PRESETS } from '../lib/presets'
import type { PresetId } from '../lib/presets'

type Preset = Exclude<PresetId, 'custom'>

const FORMATS: { id: Preset; name: string; use: string }[] = [
  { id: '4:5', name: 'Post', use: 'Instagram feed' },
  { id: '3:4', name: 'Tall post', use: 'Instagram grid' },
  { id: '1:1', name: 'Square', use: 'Feed, LinkedIn' },
  { id: '9:16', name: 'Vertical', use: 'Reels, TikTok, Stories' },
  { id: 'hd', name: 'Wide', use: 'YouTube, slides' },
]

interface Recent {
  path: string
  name: string
  when: string
  previewUrl: string | null
}

function relativeDay(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  fonts: string[]
  onFontsOpen: () => void
  onBlank: (preset: Preset) => void
  onTemplate: (deck: TemplateDeck) => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onClose: () => void
}

/** The front door: start blank in a format, start from a structure drawn in
 *  your brand, or pick up a recent project. Sits over the editor (the header
 *  stays live), so closing it is just going back to the canvas. */
export default function StartScreen({ fonts, onFontsOpen, onBlank, onTemplate, onOpen, onOpenRecent, onClose }: Props) {
  const brand = useBrandStore((s) => s.brand)
  const rootRef = useRef<HTMLDivElement>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [recents, setRecents] = useState<Recent[]>([])
  const desktop = !!window.electronAPI

  useEffect(() => { rootRef.current?.focus() }, [])

  // Template cards show their real first slide, redrawn as the brand changes.
  useEffect(() => {
    let stale = false
    const timer = setTimeout(() => {
      void (async () => {
        // Canvas text falls back silently when a face isn't ready yet.
        await Promise.all([brand.headingFont, brand.bodyFont].map((f) =>
          document.fonts.load(`700 40px "${f}"`).catch(() => [])))
        for (const t of TEMPLATES) {
          const deck = t.build(brand)
          const first = deck.slides[0]!
          const url = await generateThumbnail(
            deck.items.filter((i) => i.slideId === first.id), deck.dimensions, 440, 440, first,
          ).catch(() => '')
          if (stale) return
          if (url) setThumbs((prev) => ({ ...prev, [t.id]: url }))
        }
      })()
    }, 120)
    return () => { stale = true; clearTimeout(timer) }
  }, [brand])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.getRecentDetails) return
    let urls: string[] = []
    let gone = false
    void api.getRecentDetails().then((list) => {
      if (gone) return
      setRecents(list.map((r) => {
        const previewUrl = r.preview ? URL.createObjectURL(new Blob([r.preview as BlobPart], { type: 'image/png' })) : null
        if (previewUrl) urls.push(previewUrl)
        return {
          path: r.path,
          name: (r.path.split(/[/\\]/).pop() || r.path).replace(/\.vpost$/i, ''),
          when: relativeDay(r.modified),
          previewUrl,
        }
      }))
    }).catch(() => { /* list stays empty */ })
    return () => {
      gone = true
      for (const u of urls) URL.revokeObjectURL(u)
      urls = []
    }
  }, [])

  const pickTemplate = (t: Template) => onTemplate(t.build(brand))

  return (
    <div
      ref={rootRef}
      className="start"
      role="dialog"
      aria-label="Start"
      tabIndex={-1}
      onKeyDown={(e) => {
        // Keep keystrokes away from the canvas shortcuts underneath.
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
      }}
    >
      <div className="start__inner">
        <div className="start__main">
          <header className="start__head">
            <h1>What are you making?</h1>
            <button type="button" className="btn" onClick={onClose} title="Back to the canvas (Esc)">
              Back to canvas
            </button>
          </header>

          <section>
            <h2 className="start__label">Blank</h2>
            <div className="start__formats">
              {FORMATS.map((f) => {
                const size = PRESETS[f.id]
                return (
                  <button key={f.id} type="button" className="start__format" onClick={() => onBlank(f.id)}>
                    <span className="start__format-shape" aria-hidden>
                      <span style={{ aspectRatio: `${size.width} / ${size.height}` }} />
                    </span>
                    <b>{f.name}</b>
                    <span>{f.use}</span>
                    <span className="start__format-dims">{size.width}×{size.height}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h2 className="start__label">Start from a structure</h2>
            <div className="start__templates">
              {TEMPLATES.map((t) => {
                const deck = t.build(brand)
                return (
                  <button key={t.id} type="button" className="start__template" onClick={() => pickTemplate(t)}>
                    <span
                      className="start__template-thumb"
                      style={{ aspectRatio: `${deck.dimensions.width} / ${deck.dimensions.height}`, background: deck.slides[0]!.bgColor }}
                    >
                      {thumbs[t.id] && <img src={thumbs[t.id]} alt="" draggable={false} />}
                    </span>
                    <b>{t.name}</b>
                    <span>{t.blurb} · {deck.slides.length} {deck.slides.length === 1 ? 'slide' : 'slides'}</span>
                  </button>
                )
              })}
            </div>
          </section>
        </div>

        <aside className="start__side">
          <section>
            <h2 className="start__label">Your brand</h2>
            <p className="start__hint">Structures are drawn in these. Change them any time.</p>
            <BrandKitEditor fonts={fonts} onFontsOpen={onFontsOpen} />
          </section>

          {desktop && (
            <section>
              <h2 className="start__label">Recent</h2>
              {recents.length === 0 ? (
                <p className="start__hint">Projects you save show up here.</p>
              ) : (
                <ul className="start__recents">
                  {recents.map((r) => (
                    <li key={r.path}>
                      <button type="button" className="start__recent" onClick={() => onOpenRecent(r.path)} title={r.path}>
                        <span className="start__recent-thumb">
                          {r.previewUrl && <img src={r.previewUrl} alt="" draggable={false} />}
                        </span>
                        <span className="start__recent-text">
                          <b>{r.name}</b>
                          <span>{r.when}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn btn--sm start__open" onClick={onOpen}>Open a project…</button>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
