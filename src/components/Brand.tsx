import { useState } from 'react'
import FontPicker from './FontPicker'
import { toast } from '../lib/feedback'
import { useBrandStore } from '../lib/brand'
import type { BrandKit } from '../lib/brand'

const COLORS: { key: 'background' | 'text' | 'accent'; label: string; title: string }[] = [
  { key: 'background', label: 'Ground', title: 'Slide background' },
  { key: 'text', label: 'Text', title: 'Text colour on that background' },
  { key: 'accent', label: 'Accent', title: 'The one loud colour: covers, highlights, calls to action' },
]

/** The brand kit's fields. Edits save as you go. */
export function BrandKitEditor({ fonts, onFontsOpen }: { fonts: string[]; onFontsOpen?: () => void }) {
  const brand = useBrandStore((s) => s.brand)
  const setBrand = useBrandStore((s) => s.setBrand)
  const font = (key: 'headingFont' | 'bodyFont', label: string) => (
    <label className="field">
      <span>{label}</span>
      <FontPicker
        value={brand[key]}
        fonts={fonts}
        onCommit={(f) => setBrand({ [key]: f } as Partial<BrandKit>)}
        // Nothing on the canvas follows the kit live, so there's nothing to preview.
        onPreview={() => {}}
        onOpen={onFontsOpen}
      />
    </label>
  )
  return (
    <div className="brand-editor">
      <div className="brand-editor__colors">
        {COLORS.map((c) => (
          <label key={c.key} className="brand-editor__color" title={c.title}>
            <input
              className="color-swatch"
              type="color"
              value={brand[c.key]}
              onChange={(e) => setBrand({ [c.key]: e.target.value } as Partial<BrandKit>)}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
      {font('headingFont', 'Heading font')}
      {font('bodyFont', 'Body font')}
      <label className="field">
        <span>Handle</span>
        <input
          type="text"
          value={brand.handle}
          placeholder="@yourname"
          spellCheck={false}
          onChange={(e) => setBrand({ handle: e.target.value })}
          title="Stamped in the corner of every slide in templates. Leave empty for none."
        />
      </label>
      <label className="field">
        <span>Voice</span>
        <textarea
          value={brand.voice}
          rows={3}
          placeholder="How you write: plain and direct, a little dry, no hype…"
          onChange={(e) => setBrand({ voice: e.target.value })}
          title="The assistant and connected agents write in this voice."
        />
      </label>
      <BrandFromPosts fonts={fonts} />
    </div>
  )
}

interface Learned {
  background: string
  text: string
  accent: string
  headingFont: string
  bodyFont: string
  voice: string
  notes: string
}

/** "Learn from past posts": Claude reads a few of your old posts and proposes
 *  a kit. Nothing changes until you accept it. */
function BrandFromPosts({ fonts }: { fonts: string[] }) {
  const setBrand = useBrandStore((s) => s.setBrand)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Learned | null>(null)
  const api = window.electronAPI
  if (!api?.aiRun) return null

  const learn = async () => {
    const status = await api.aiStatus()
    if (!status.source) { toast('Add your API key in the Assistant first.', { kind: 'error' }); return }
    const paths = await api.aiPickImages()
    if (paths.length === 0) return
    setBusy(true)
    setFound(null)
    try {
      const res = await api.aiRun({ runId: crypto.randomUUID(), task: 'brand', params: { paths, fonts } })
      if (res.ok) setFound(res.result as Learned)
      else if (!res.cancelled) toast(res.error ?? 'Could not read those posts.', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const hex = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback)

  return (
    <div className="brand-learn">
      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => { void learn() }}>
        {busy ? 'Studying your posts…' : 'Learn from past posts…'}
      </button>
      {found && (
        <div className="brand-learn__found">
          <div className="brand-learn__swatches" aria-hidden>
            {[found.background, found.text, found.accent].map((c, i) => <span key={i} style={{ background: hex(c, '#888888') }} />)}
          </div>
          <p><b>{found.headingFont}</b> for headings, <b>{found.bodyFont}</b> for body.</p>
          <p>{found.voice}</p>
          <p className="brand-learn__notes">{found.notes}</p>
          <div className="brand-learn__actions">
            <button
              type="button"
              className="btn btn--sm btn--seg-active"
              onClick={() => {
                const cur = useBrandStore.getState().brand
                setBrand({
                  background: hex(found.background, cur.background),
                  text: hex(found.text, cur.text),
                  accent: hex(found.accent, cur.accent),
                  // Only families that are really installed.
                  headingFont: fonts.includes(found.headingFont) ? found.headingFont : cur.headingFont,
                  bodyFont: fonts.includes(found.bodyFont) ? found.bodyFont : cur.bodyFont,
                  voice: found.voice,
                })
                setFound(null)
              }}
            >
              Use this
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setFound(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Three dots beside a colour field: one click sets it to a brand colour. */
export function BrandSwatches({ value, onPick }: { value?: string; onPick: (color: string) => void }) {
  const brand = useBrandStore((s) => s.brand)
  return (
    <span className="brand-swatches" role="group" aria-label="Brand colours">
      {COLORS.map((c) => {
        const color = brand[c.key]
        const on = value?.toLowerCase() === color.toLowerCase()
        return (
          <button
            key={c.key}
            type="button"
            className={`brand-swatches__dot${on ? ' brand-swatches__dot--on' : ''}`}
            style={{ background: color }}
            title={`Brand ${c.label.toLowerCase()} · ${color}`}
            aria-label={`Brand ${c.label.toLowerCase()}`}
            aria-pressed={on}
            // A <label> wraps most colour fields: without this the click
            // would also open the native colour picker.
            onClick={(e) => { e.preventDefault(); onPick(color) }}
          />
        )
      })}
    </span>
  )
}
