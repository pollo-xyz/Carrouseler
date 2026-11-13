import FontPicker from './FontPicker'
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
