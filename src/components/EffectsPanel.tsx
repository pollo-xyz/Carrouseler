import { useTiovivoStore, type PlacedMedia } from '../store/useTiovivoStore'
import { useBrandStore } from '../lib/brand'
import {
  EFFECT_DEFAULTS, EFFECT_KINDS, accentWords, effectApplies, glowColor, hasMotion, parseAccents,
  toggleAccentWord,
  type EffectKind, type EffectSettings,
} from '../lib/effects'

function fill(value: number, min: number, max: number): React.CSSProperties {
  const pct = ((value - min) / (max - min)) * 100
  return { ['--fill' as string]: `${Math.min(100, Math.max(0, pct))}%` } as React.CSSProperties
}

function Slider({ label, value, min, max, step, show, title, onChange, onReset }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  show: string
  title?: string
  onChange: (v: number) => void
  onReset: () => void
}) {
  return (
    <label className="slider-field" title={title ? `${title} Double-click to reset.` : 'Double-click to reset.'}>
      <span className="slider-field__label">
        {label}<span className="slider-field__value">{show}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={fill(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
      />
    </label>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const secs = (v: number) => `${v.toFixed(1)} s`
const DIRECTIONS: { angle: number; label: string }[] = [
  { angle: 90, label: 'Up / down' },
  { angle: 0, label: 'Sideways' },
  { angle: 45, label: 'Diagonal' },
]

/** The Effects section of the selection panel: accent words for text, then
 *  one switch per effect with its settings underneath while it is on. */
export default function EffectsPanel({ item }: { item: PlacedMedia }) {
  const updateItem = useTiovivoStore((s) => s.updateItem)
  const playing = useTiovivoStore((s) => s.playing)
  const setPlaying = useTiovivoStore((s) => s.setPlaying)
  const brandAccent = useBrandStore((s) => s.brand.accent)

  const kinds = EFFECT_KINDS.filter((k) => effectApplies(k.kind, item))
  const setFx = (kind: EffectKind, patch: Partial<EffectSettings>) => {
    const current = item.effects?.[kind] ?? { on: true }
    updateItem(item.id, { effects: { ...item.effects, [kind]: { ...current, ...patch } } })
  }
  const toggle = (kind: EffectKind, on: boolean) => {
    setFx(kind, { on })
    // Switching on something that moves starts the clock, so it is seen.
    if (on && (kind !== 'glow') && !playing) setPlaying(true)
  }

  const isText = item.type === 'text'
  const words = isText && item.accentColor ? accentWords(item.text || '') : []
  const moving = hasMotion(item)

  return (
    <div className="fx">
      <div className="fx__head">
        <h2>Effects</h2>
        <button
          type="button"
          className={`btn btn--sm ${playing ? 'btn--seg-active' : ''}`}
          onClick={() => setPlaying(!playing)}
          aria-pressed={playing}
          title={playing ? 'Stop the effects preview' : 'Play every slide\'s effects in the editor'}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
      </div>

      {isText && (
        <div className="fx__accent">
          {item.accentColor ? (
            <>
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <span>Accent</span>
                <input
                  className="color-swatch"
                  type="color"
                  value={item.accentColor}
                  onChange={(e) => updateItem(item.id, { accentColor: e.target.value })}
                />
                <span className="field__value" style={{ flex: 1 }}>{item.accentColor}</span>
                <button
                  type="button"
                  className="btn btn--sm"
                  title="Remove the accent colour and its word marks"
                  onClick={() => updateItem(item.id, { accentColor: undefined, text: parseAccents(item.text || '').clean })}
                >
                  Remove
                </button>
              </label>
              <div className="fx__chips" role="group" aria-label="Accent words">
                {words.slice(0, 80).map((w, i) => (
                  <button
                    key={`${i}-${w.word}`}
                    type="button"
                    className={`fx-chip ${w.accent ? 'fx-chip--on' : ''}`}
                    style={w.accent ? { color: item.accentColor } : undefined}
                    aria-pressed={w.accent}
                    onClick={() => updateItem(item.id, { text: toggleAccentWord(item.text || '', i) })}
                  >
                    {w.word}
                  </button>
                ))}
              </div>
              <p className="fx__hint">Click a word to accent it, or wrap words in *asterisks* while typing.</p>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--sm"
              style={{ width: '100%' }}
              title="Pick words to draw in a second colour"
              onClick={() => updateItem(item.id, { accentColor: brandAccent || '#2dd4bf' })}
            >
              Add accent words
            </button>
          )}
        </div>
      )}

      {kinds.map(({ kind, label, hint }) => {
        const raw = item.effects?.[kind]
        const on = !!raw?.on
        const d = EFFECT_DEFAULTS[kind]
        const v = { ...d, ...raw }
        const speed = (
          <Slider
            label="Speed" value={v.speed} min={0.25} max={3} step={0.05} show={`${v.speed.toFixed(2)}×`}
            onChange={(n) => setFx(kind, { speed: n })} onReset={() => setFx(kind, { speed: d.speed })}
          />
        )
        const delay = (
          <Slider
            label="Starts after" value={v.delay} min={0} max={6} step={0.1} show={secs(v.delay)}
            title="Seconds into the slide before this begins. Offset layers to run them in sequence."
            onChange={(n) => setFx(kind, { delay: n })} onReset={() => setFx(kind, { delay: d.delay })}
          />
        )
        const strength = (name: string) => (
          <Slider
            label={name} value={v.strength} min={0} max={1} step={0.01} show={pct(v.strength)}
            onChange={(n) => setFx(kind, { strength: n })} onReset={() => setFx(kind, { strength: d.strength })}
          />
        )
        const every = (
          <Slider
            label="Repeats every" value={v.every ?? 0} min={0} max={8} step={0.5}
            show={(v.every ?? 0) > 0 ? secs(v.every ?? 0) : 'Once'}
            title="Seconds from one to the next. Once = a single time each loop of the slide."
            onChange={(n) => setFx(kind, { every: n })} onReset={() => setFx(kind, { every: d.every })}
          />
        )
        const color = (name: string, value: string, auto?: boolean) => (
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <span>{name}</span>
            <input
              className="color-swatch"
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
              onChange={(e) => setFx(kind, { color: e.target.value })}
            />
            <span className="field__value" style={{ flex: 1 }}>{raw?.color ?? (auto ? 'layer colour' : value)}</span>
            {auto && raw?.color && (
              <button type="button" className="btn btn--sm" onClick={() => setFx(kind, { color: undefined })}>Auto</button>
            )}
          </label>
        )
        return (
          <div key={kind} className={`fx__row ${on ? 'fx__row--on' : ''}`}>
            <label className="check" title={hint}>
              <input type="checkbox" checked={on} onChange={(e) => toggle(kind, e.target.checked)} />
              {label}
            </label>
            {on && (
              <div className="fx__body">
                {kind === 'glow' && (
                  <>
                    {strength('Strength')}
                    {color('Colour', glowColor(item), true)}
                    <label className="check" title="The glow swells and fades instead of holding steady.">
                      <input
                        type="checkbox"
                        checked={!!v.breathe}
                        onChange={(e) => {
                          setFx(kind, { breathe: e.target.checked })
                          if (e.target.checked && !playing) setPlaying(true)
                        }}
                      />
                      Breathe
                    </label>
                    {v.breathe && speed}
                    {v.breathe && delay}
                  </>
                )}
                {kind === 'pulse' && <>{strength('Strength')}{speed}{every}{delay}</>}
                {kind === 'drift' && (
                  <>
                    {strength('Distance')}
                    {speed}
                    <div className="app__presets" role="group" aria-label="Drift direction">
                      {DIRECTIONS.map((dir) => (
                        <button
                          key={dir.angle}
                          type="button"
                          className={`btn ${(v.angle ?? 90) === dir.angle ? 'btn--seg-active' : ''}`}
                          style={{ flex: 1 }}
                          onClick={() => setFx(kind, { angle: dir.angle })}
                        >
                          {dir.label}
                        </button>
                      ))}
                    </div>
                    {delay}
                  </>
                )}
                {kind === 'shimmer' && <>{strength('Strength')}{speed}{every}{delay}{color('Light', v.color ?? '#ffffff')}</>}
                {kind === 'flash' && <>{speed}{every}{delay}</>}
                {kind === 'highlight' && (
                  <>
                    {!words.some((w) => w.accent) && <p className="fx__hint">Pick accent words above for this to light up.</p>}
                    {speed}
                    {delay}
                  </>
                )}
                {kind === 'reveal' && <>{strength('Dim before')}{speed}{delay}</>}
                {kind === 'travel' && (
                  <>
                    <Slider
                      label="Starts from, across" value={v.dx ?? 0} min={-800} max={800} step={10} show={`${Math.round(v.dx ?? 0)} px`}
                      title="How far left (−) or right (+) of its resting place the pointer starts."
                      onChange={(n) => setFx(kind, { dx: n })} onReset={() => setFx(kind, { dx: d.dx })}
                    />
                    <Slider
                      label="Starts from, down" value={v.dy ?? 0} min={-800} max={800} step={10} show={`${Math.round(v.dy ?? 0)} px`}
                      title="How far above (−) or below (+) its resting place the pointer starts."
                      onChange={(n) => setFx(kind, { dy: n })} onReset={() => setFx(kind, { dy: d.dy })}
                    />
                    {speed}
                    {delay}
                    {every}
                    {strength('Click ring')}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
      {moving && (
        <p className="fx__hint">This slide exports as a looping video; photo exports show it at rest.</p>
      )}
    </div>
  )
}
