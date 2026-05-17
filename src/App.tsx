import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EditorStage, { type EditorStageHandle } from './components/EditorStage'
import NumberField from './components/NumberField'
import MenuBar from './components/MenuBar'
import { useTiovivoStore, type PlacedMedia, type TextAlign } from './store/useTiovivoStore'
import { PRESETS } from './lib/presets'
import { serializeProject, deserializeProject, hydrateItems } from './lib/projectFile'
import { generateProjectPreview } from './lib/thumbnail'
import { FALLBACK_FONTS, listSystemFonts } from './lib/fonts'
import { detectVideoFps, fpsRoughlyEqual, roundToCommonFps } from './lib/detectVideoFps'
import { videoElements } from './lib/videoRegistry'
import { NAMED_PALETTES, defaultBgVibe, randomSeed, type BgVibe } from './lib/bgVibe'
import { sampleMediaPalette } from './lib/sampleMediaPalette'
// 256×256 sibling of the main app icon, exported specifically for the
// in-app brand mark / future small UI uses. Avoids bundling the full
// 2400×2400 5.7 MB original into the renderer build just to render at
// 22 px. Vite hashes and resolves the URL at build time.
import appIconUrl from '../resources/tiovivo_appicon_small.png'
import './App.css'

const VPOST_FILTER = [{ name: 'Tiovivo Project', extensions: ['vpost'] }]

// Strip characters that are illegal or troublesome in filenames on macOS,
// Windows, and Linux. Trim trailing dots/spaces too (Windows refuses them).
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '')
}

// Tighter sanitiser for filename *segments* (e.g. the slide name inserted
// between prefix and number). Collapses whitespace to single underscores so
// "Cover slide" → "Cover_slide" rather than producing filenames with spaces.
function sanitizeFilenameSegment(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
}

/* ============================================================
   Tiny inline icon set — keeps bundle small, tunable with CSS
   ============================================================ */
const Icon = {
  Export: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 4v12" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  ),
  Plus: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Grid: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Sliders: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  Target: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  Trash: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  ),
  Reset: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  ),
  Text: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 4h14" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </svg>
  ),
  Link: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  ),
  LinkOff: (p: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10 13a5 5 0 0 0 7.07 0l1-1" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-1 1" />
      <path d="M3 3l18 18" />
    </svg>
  ),
}


/** Format seconds → "1m 04s" / "12s" for the export elapsed-time readout. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/** Drives the gradient-filled track on .slider-field range inputs. Mirrors the
 *  helper in EditorStage.tsx; shared here so every panel slider can use the
 *  same look without duplicating the math. */
function sliderFill(value: number, min: number, max: number): React.CSSProperties {
  const pct = ((value - min) / (max - min)) * 100
  return { ['--fill' as string]: `${Math.min(100, Math.max(0, pct))}%` } as React.CSSProperties
}

/* ============================================================
   BackgroundPanel — Solid/Vibe modes, palette, sliders, randomize
   ============================================================ */

type BackgroundPanelProps = {
  slides: ReturnType<typeof useTiovivoStore.getState>['slides']
  activeSlideId: string
  /** Single-selection media item to sample colours from; null when the user
   *  has nothing selected or has selected multiple / non-media items. */
  selectedMediaItem: PlacedMedia | null
  setAllSlidesBgVibe: (vibe: Omit<BgVibe, 'seed'> | null) => void
  setSlideBgVibe: (slideId: string, vibe: BgVibe | null) => void
  randomizeAllSlideVibes: () => void
  randomizeSlideVibe: (slideId: string) => void
}

function BackgroundPanel({
  slides,
  activeSlideId,
  selectedMediaItem,
  setAllSlidesBgVibe,
  setSlideBgVibe,
  randomizeAllSlideVibes,
  randomizeSlideVibe,
}: BackgroundPanelProps) {
  // "Mode" is derived from whether the active slide has a vibe — keeps the
  // panel and the actual state in sync, no parallel UI state to drift.
  const activeSlide = slides.find((s) => s.id === activeSlideId)
  const mode: 'solid' | 'vibe' = activeSlide?.bgVibe ? 'vibe' : 'solid'

  // Take the active slide's vibe as the source of truth for slider/palette
  // values shown in the panel; falls back to a freshly-rolled default so
  // turning the toggle on can start drawing immediately.
  const vibe = activeSlide?.bgVibe
  const config: Omit<BgVibe, 'seed'> = useMemo(
    () =>
      vibe
        ? {
            palette: vibe.palette,
            pointCount: vibe.pointCount,
            blur: vibe.blur,
            grain: vibe.grain,
            size: vibe.size ?? 1,
            randomSize: vibe.randomSize ?? false,
            randomLayer: vibe.randomLayer ?? false,
          }
        : (() => {
            const d = defaultBgVibe()
            return {
              palette: d.palette,
              pointCount: d.pointCount,
              blur: d.blur,
              grain: d.grain,
              size: d.size ?? 1,
              randomSize: d.randomSize ?? false,
              randomLayer: d.randomLayer ?? false,
            }
          })(),
    [vibe],
  )

  // Custom user palettes — persisted to localStorage so they outlive the
  // current project. Each entry is { name, colors }, matching NAMED_PALETTES.
  const [customPalettes, setCustomPalettes] = useState<{ name: string; colors: string[] }[]>(() => {
    try {
      const raw = localStorage.getItem('tiovivo.customPalettes')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (p: unknown): p is { name: string; colors: string[] } =>
          !!p &&
          typeof (p as { name?: unknown }).name === 'string' &&
          Array.isArray((p as { colors?: unknown }).colors) &&
          (p as { colors: unknown[] }).colors.every((c) => typeof c === 'string'),
      )
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('tiovivo.customPalettes', JSON.stringify(customPalettes))
    } catch {
      // localStorage may be unavailable / full — best-effort.
    }
  }, [customPalettes])

  const savePaletteAsCustom = () => {
    // Auto-name as CustomN — pick the lowest free integer so deleting and
    // re-saving reuses gaps rather than creeping the counter forward forever.
    // Double-click the preset row to rename afterwards.
    setCustomPalettes((cur) => {
      const taken = new Set(cur.map((p) => p.name))
      let n = 1
      while (taken.has(`Custom${n}`)) n++
      return [...cur, { name: `Custom${n}`, colors: [...config.palette] }]
    })
  }

  const deleteCustomPalette = (name: string) => {
    if (!window.confirm(`Delete the "${name}" palette?`)) return
    setCustomPalettes((cur) => cur.filter((p) => p.name !== name))
  }

  // Inline rename for a saved custom palette. Double-click its name to enter,
  // Enter / blur commits, Escape cancels. Collisions get auto-suffixed so two
  // entries never share a name (which would make them indistinguishable in
  // the preset list).
  const [renamingCustomName, setRenamingCustomName] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const commitRename = (oldName: string) => {
    const trimmed = renameDraft.trim()
    setRenamingCustomName(null)
    if (!trimmed || trimmed === oldName) return
    setCustomPalettes((cur) => {
      // If another entry already uses this name, append " 2", " 3", … so the
      // rename always succeeds rather than silently dropping the user's input.
      let target = trimmed
      if (cur.some((p) => p.name === target && p.name !== oldName)) {
        let k = 2
        while (cur.some((p) => p.name === `${trimmed} ${k}`)) k++
        target = `${trimmed} ${k}`
      }
      return cur.map((p) => (p.name === oldName ? { ...p, name: target } : p))
    })
  }

  // Each click on "Sample from Media" passes an incrementing seed so the
  // helper takes a slightly different statistical view of the image. Reset
  // when the selected media item changes so the first click on a new image
  // is the canonical deterministic result, not a subsampled variation.
  const sampleSeedRef = useRef(0)
  useEffect(() => {
    sampleSeedRef.current = 0
  }, [selectedMediaItem?.id])

  // Scope: 'all' propagates every panel edit to every slide (keeping each
  // slide's existing seed so positions don't reshuffle on slider drag).
  // 'selected' confines edits to the active slide only — switch into this
  // mode when you want to make one slide diverge from the rest.
  const [scope, setScope] = useState<'all' | 'selected'>('all')

  const apply = useCallback(
    (patch: Partial<Omit<BgVibe, 'seed'>>) => {
      if (scope === 'all') {
        setAllSlidesBgVibe({ ...config, ...patch })
      } else {
        // Preserve the active slide's existing seed when one is set, otherwise
        // mint a fresh one (so first-touch in 'selected' mode immediately
        // gives this slide a distinct composition).
        const seed = activeSlide?.bgVibe?.seed ?? randomSeed()
        setSlideBgVibe(activeSlideId, { ...config, ...patch, seed })
      }
    },
    [config, scope, activeSlide, activeSlideId, setAllSlidesBgVibe, setSlideBgVibe],
  )

  const setPaletteColor = (i: number, color: string) => {
    const next = config.palette.slice()
    next[i] = color
    apply({ palette: next })
  }
  const addPaletteColor = () => {
    if (config.palette.length >= 8) return
    const seed = config.palette[config.palette.length - 1] || '#888888'
    apply({ palette: [...config.palette, seed] })
  }
  const removePaletteColor = (i: number) => {
    if (config.palette.length <= 2) return
    apply({ palette: config.palette.filter((_, idx) => idx !== i) })
  }

  // Solid/Vibe toggle and palette/slider edits all route through these so the
  // scope-aware branching lives in one place.
  const setMode = (next: 'solid' | 'vibe') => {
    if (next === 'solid') {
      if (scope === 'all') setAllSlidesBgVibe(null)
      else setSlideBgVibe(activeSlideId, null)
    } else {
      if (scope === 'all') {
        setAllSlidesBgVibe(config)
      } else {
        const seed = activeSlide?.bgVibe?.seed ?? randomSeed()
        setSlideBgVibe(activeSlideId, { ...config, seed })
      }
    }
  }

  const hasMultipleSlides = slides.length > 1

  return (
    <>
      {/* Mode selector — same segmented-pill structure as the header's
          HD/1:1/4:5 preset row, but uses the quieter .btn--seg-active for
          the in-panel context where the bright accent glow felt overbearing. */}
      <div className="app__presets" style={{ marginBottom: 4 }}>
        <button
          type="button"
          className={`btn ${mode === 'solid' ? 'btn--seg-active' : ''}`}
          onClick={() => setMode('solid')}
          style={{ flex: 1 }}
        >
          Solid
        </button>
        <button
          type="button"
          className={`btn ${mode === 'vibe' ? 'btn--seg-active' : ''}`}
          onClick={() => setMode('vibe')}
          style={{ flex: 1 }}
        >
          Vibe
        </button>
      </div>

      {/* Scope — 'All slides' (default) or 'Selected slide'. Only meaningful
          for Vibe (where multiple settings can diverge between slides) and
          when there's more than one slide. */}
      {hasMultipleSlides && mode === 'vibe' && (
        <div className="app__presets" style={{ marginBottom: 6 }}>
          <button
            type="button"
            className={`btn ${scope === 'all' ? 'btn--seg-active' : ''}`}
            onClick={() => setScope('all')}
            style={{ flex: 1 }}
            title="Edits, randomize and Solid/Vibe affect every slide (default)"
          >
            All slides
          </button>
          <button
            type="button"
            className={`btn ${scope === 'selected' ? 'btn--seg-active' : ''}`}
            onClick={() => setScope('selected')}
            style={{ flex: 1 }}
            title="Edits affect only the currently selected slide"
          >
            Selected slide
          </button>
        </div>
      )}

      {mode === 'vibe' && (
        <>
          {/* Palette swatches. palette[0] is the base wash — the "BG" badge
              sits over its swatch (pointer-events: none so clicks fall through
              to the colour input) and replaces the prior "First swatch is the
              base" hint. */}
          <div className="field">
            <span>
              Palette
              <span className="hint hint--inline" style={{ marginLeft: 6 }}>
                · Right-click to remove
              </span>
            </span>
            <div className="palette-grid">
              {config.palette.map((c, i) => {
                if (i === 0) {
                  return (
                    <span key={i} className="palette-swatch-wrap">
                      <input
                        className="palette-swatch palette-swatch--base"
                        type="color"
                        value={c}
                        onChange={(e) => setPaletteColor(0, e.target.value)}
                        title="Base / background colour — always painted first"
                        onContextMenu={(e) => { e.preventDefault(); removePaletteColor(0) }}
                      />
                      <span className="palette-swatch__badge" aria-hidden>BG</span>
                    </span>
                  )
                }
                return (
                  <input
                    key={i}
                    className="palette-swatch"
                    type="color"
                    value={c}
                    onChange={(e) => setPaletteColor(i, e.target.value)}
                    title="Click to edit, right-click to remove"
                    onContextMenu={(e) => { e.preventDefault(); removePaletteColor(i) }}
                  />
                )
              })}
              {config.palette.length < 8 && (
                <button
                  type="button"
                  className="palette-swatch palette-swatch--add"
                  onClick={addPaletteColor}
                  title="Add a color"
                >
                  +
                </button>
              )}
            </div>
            {/* Palette actions — sit directly under the swatch grid so the
                relationship between buttons and palette is obvious. Sample
                button is disabled until a single media item is selected. */}
            <div className="palette-actions">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={savePaletteAsCustom}
                title="Save the current palette so it's available in every project"
              >
                + Save preset
              </button>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={async () => {
                  if (!selectedMediaItem) return
                  // First click on this item = canonical (seed 0); each
                  // subsequent click increments → seeded subsample for a
                  // different palette take on the same image.
                  const seed = sampleSeedRef.current
                  sampleSeedRef.current = seed + 1
                  try {
                    const colors = await sampleMediaPalette(
                      selectedMediaItem,
                      Math.max(2, config.palette.length),
                      seed,
                    )
                    if (colors.length) apply({ palette: colors })
                  } catch (err) {
                    console.error('[sample-from-media] failed:', err)
                    alert(
                      'Could not sample colours from the selected media. ' +
                      'For videos make sure the frame is decoded; for images, check the file is still loaded.',
                    )
                  }
                }}
                disabled={!selectedMediaItem}
                title={
                  selectedMediaItem
                    ? `Sample colours from "${selectedMediaItem.name}" — click again for variations`
                    : 'Select a single image or video on the canvas to enable'
                }
              >
                Sample from Media
              </button>
            </div>
          </div>

          {/* Preset palettes — quick-pick. Built-in palettes first, custom
              (user-saved) entries pinned at the bottom under a small
              divider. List is bounded and scrolls internally so a growing
              custom collection doesn't push the sliders off-screen. */}
          <div className="field">
            <span>Presets</span>
            <div className="preset-list">
              {NAMED_PALETTES.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="preset"
                  onClick={() => apply({ palette: [...preset.colors] })}
                  title={`Use the ${preset.name} palette`}
                >
                  <span className="preset__name">{preset.name}</span>
                  <span className="preset__swatches">
                    {preset.colors.map((c, j) => (
                      <span key={j} style={{ background: c }} />
                    ))}
                  </span>
                </button>
              ))}
              {customPalettes.length > 0 && (
                <div className="preset-list__divider">Custom</div>
              )}
              {customPalettes.map((preset) => {
                const isRenaming = renamingCustomName === preset.name
                return (
                  <div key={`custom-${preset.name}`} className="preset preset--custom">
                    <button
                      type="button"
                      className="preset__pick"
                      onClick={() => { if (!isRenaming) apply({ palette: [...preset.colors] }) }}
                      title={isRenaming ? undefined : `Use the ${preset.name} palette · double-click name to rename`}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          type="text"
                          className="preset__name preset__name-input"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitRename(preset.name) }
                            else if (e.key === 'Escape') { e.preventDefault(); setRenamingCustomName(null) }
                            e.stopPropagation()
                          }}
                          onBlur={() => commitRename(preset.name)}
                          // Block parent button click while editing.
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onFocus={(e) => e.currentTarget.select()}
                          spellCheck={false}
                          maxLength={32}
                        />
                      ) : (
                        <span
                          className="preset__name"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setRenameDraft(preset.name)
                            setRenamingCustomName(preset.name)
                          }}
                        >
                          {preset.name}
                        </span>
                      )}
                      <span className="preset__swatches">
                        {preset.colors.map((c, j) => (
                          <span key={j} style={{ background: c }} />
                        ))}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="preset__delete"
                      onClick={(e) => { e.stopPropagation(); deleteCustomPalette(preset.name) }}
                      title="Delete this palette"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Sliders — same .slider-field pattern as the item Corrections popover. */}
          <label className="slider-field">
            <span className="slider-field__label">
              Points<span className="slider-field__value">{config.pointCount}</span>
            </span>
            <input
              type="range"
              min={3}
              max={8}
              step={1}
              value={config.pointCount}
              style={sliderFill(config.pointCount, 3, 8)}
              onChange={(e) => apply({ pointCount: Number(e.target.value) })}
            />
          </label>
          {/* Size acts as the macro scale of every blob. Composes with the
              Randomize size toggle below: that adds per-point jitter (0.55×
              –1.45×) around whatever Size value is set, so Size=2 + Random
              size gives points ~1.1×–2.9× of the original baseR. */}
          <label className="slider-field">
            <span className="slider-field__label">
              Size<span className="slider-field__value">{Math.round((config.size ?? 1) * 100)}%</span>
            </span>
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.05}
              value={config.size ?? 1}
              style={sliderFill(config.size ?? 1, 0.4, 2.5)}
              onChange={(e) => apply({ size: Number(e.target.value) })}
            />
          </label>
          <label className="slider-field">
            <span className="slider-field__label">
              Blur<span className="slider-field__value">{Math.round(config.blur)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={config.blur}
              style={sliderFill(config.blur, 0, 200)}
              onChange={(e) => apply({ blur: Number(e.target.value) })}
            />
          </label>
          <label className="slider-field">
            <span className="slider-field__label">
              Grain<span className="slider-field__value">{Math.round(config.grain * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.grain}
              style={sliderFill(config.grain, 0, 1)}
              onChange={(e) => apply({ grain: Number(e.target.value) })}
            />
          </label>

          {/* Per-seed variation toggles. Both are deterministic from the seed,
              so rerolling (Randomize) varies the result; toggling them off
              returns to a uniform / palette-order rendering. */}
          <label className="check" title="Each blob gets a per-point seeded size multiplier (0.55×–1.45×) — some are smaller, some larger.">
            <input
              type="checkbox"
              checked={!!config.randomSize}
              onChange={(e) => apply({ randomSize: e.target.checked })}
            />
            Randomize size
          </label>
          <label className="check" title="Paint blobs in a seed-shuffled order instead of palette order — changes which colors land on top.">
            <input
              type="checkbox"
              checked={!!config.randomLayer}
              onChange={(e) => apply({ randomLayer: e.target.checked })}
            />
            Randomize layer
          </label>

          {/* Randomize buttons */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => randomizeAllSlideVibes()}
              title="Reroll point positions on every slide"
              style={{ flex: 1, flexDirection: 'row', gap: 6, padding: '6px 10px', justifyContent: 'center' }}
            >
              <Icon.Reset style={{ width: 12, height: 12 }} />
              Randomize all
            </button>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => randomizeSlideVibe(activeSlideId)}
              title="Reroll point positions on the active slide only"
              style={{ flex: 1, flexDirection: 'row', gap: 6, padding: '6px 10px', justifyContent: 'center' }}
            >
              <Icon.Reset style={{ width: 12, height: 12 }} />
              This slide
            </button>
          </div>
        </>
      )}

    </>
  )
}

export default function App() {
  const stageRef = useRef<EditorStageHandle>(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  // Cycling 0–3 dots + a wall-clock timer keep the export indicator visibly
  // animated even when the percentage is stuck waiting on a slow ffmpeg frame.
  // Avoids the "is it frozen?" panic without lying about real progress.
  const [exportPulse, setExportPulse] = useState(0)
  const [exportElapsed, setExportElapsed] = useState('')
  // Preview shown under the export veil. Starts as a snapshot of whatever
  // the user was looking at pre-export so the canvas isn't visibly blank,
  // then swaps to a downscaled live capture frame as the encoder advances.
  const [exportPreview, setExportPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!exporting) {
      setExportPulse(0)
      setExportElapsed('')
      setExportPreview(null)
      return
    }
    const start = performance.now()
    const id = setInterval(() => {
      setExportPulse((p) => (p + 1) % 4)
      setExportElapsed(formatElapsed(performance.now() - start))
    }, 500)
    return () => clearInterval(id)
  }, [exporting])
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const projectPathRef = useRef<string | null>(null)
  projectPathRef.current = projectPath

  const [exportPrefix, setExportPrefix] = useState<string>('')
  // When on, export filenames become `${prefix}_${SLIDENAME}_${nn}` for any
  // slide that has a custom name; slides without a custom name fall back to
  // the plain `${prefix}_${nn}` form so the toggle never produces ugly
  // `Slide_1` filler segments. Session-local, not persisted to .vpost.
  const [includeSlideNameInFilename, setIncludeSlideNameInFilename] = useState(false)
  // Aspect-ratio lock for the W × H inputs. When on, editing one dimension
  // scales the other proportionally to the current aspect — same UX as
  // Photoshop's "Constrain Proportions" chain. Locks at the moment of edit
  // using the live dimensions, so toggling a preset and then editing
  // honours the preset's aspect.
  const [lockAspect, setLockAspect] = useState(false)
  const [viewport, setViewport] = useState({ w: 920, h: 640 })
  const [isDragOver, setIsDragOver] = useState(false)
  const [fontList, setFontList] = useState<string[]>(FALLBACK_FONTS)
  // Recently-opened .vpost paths for the in-app File menu (Windows / Linux).
  // We don't pre-fetch on macOS because Mac shows them in the native menu
  // and the in-app MenuBar isn't rendered there.
  const [recents, setRecents] = useState<{ path: string; basename: string }[]>([])
  const refreshRecents = useCallback(async () => {
    if (/Mac/.test(navigator.userAgent)) return
    try {
      const paths = await window.electronAPI?.getRecents?.()
      if (paths) {
        setRecents(paths.map((p) => ({
          path: p,
          basename: p.split(/[/\\]/).pop() || p,
        })))
      }
    } catch (err) {
      console.warn('[recents] fetch failed:', err)
    }
  }, [])
  useEffect(() => { void refreshRecents() }, [refreshRecents])

  const dimensions = useTiovivoStore((s) => s.dimensions)
  const presetId = useTiovivoStore((s) => s.presetId)
  const setPreset = useTiovivoStore((s) => s.setPreset)
  const setCustomDimensions = useTiovivoStore((s) => s.setCustomDimensions)

  const slides = useTiovivoStore((s) => s.slides)
  const activeSlideId = useTiovivoStore((s) => s.activeSlideId)
  const selectedIds = useTiovivoStore((s) => s.selectedIds)
  const items = useTiovivoStore((s) => s.items)
  const removeItem = useTiovivoStore((s) => s.removeItem)
  const removeItems = useTiovivoStore((s) => s.removeItems)
  const addMedia = useTiovivoStore((s) => s.addMedia)
  const addText = useTiovivoStore((s) => s.addText)
  const updateItem = useTiovivoStore((s) => s.updateItem)

  const showGrid = useTiovivoStore((s) => s.showGrid)
  const gridSize = useTiovivoStore((s) => s.gridSize)
  const gridOpacity = useTiovivoStore((s) => s.gridOpacity)
  const setGridOpacity = useTiovivoStore((s) => s.setGridOpacity)
  const showCenterGuides = useTiovivoStore((s) => s.showCenterGuides)
  const snapGrid = useTiovivoStore((s) => s.snapGrid)
  const snapCenter = useTiovivoStore((s) => s.snapCenter)
  const snapItems = useTiovivoStore((s) => s.snapItems)
  const snapMargins = useTiovivoStore((s) => s.snapMargins)
  const seamlessSlides = useTiovivoStore((s) => s.seamlessSlides)
  const setSeamlessSlides = useTiovivoStore((s) => s.setSeamlessSlides)
  const showHiddenZone = useTiovivoStore((s) => s.showHiddenZone)
  const setShowHiddenZone = useTiovivoStore((s) => s.setShowHiddenZone)
  const setShowGrid = useTiovivoStore((s) => s.setShowGrid)
  const setGridSize = useTiovivoStore((s) => s.setGridSize)
  const setShowCenterGuides = useTiovivoStore((s) => s.setShowCenterGuides)
  const setSnapGrid = useTiovivoStore((s) => s.setSnapGrid)
  const setSnapCenter = useTiovivoStore((s) => s.setSnapCenter)
  const setSnapItems = useTiovivoStore((s) => s.setSnapItems)
  const setSnapMargins = useTiovivoStore((s) => s.setSnapMargins)
  const setAllSlidesBgVibe = useTiovivoStore((s) => s.setAllSlidesBgVibe)
  const setSlideBgVibe = useTiovivoStore((s) => s.setSlideBgVibe)
  const randomizeAllSlideVibes = useTiovivoStore((s) => s.randomizeAllSlideVibes)
  const randomizeSlideVibe = useTiovivoStore((s) => s.randomizeSlideVibe)

  const layoutRef = useRef<HTMLDivElement>(null)
  const addMediaInputRef = useRef<HTMLInputElement>(null)
  const workspaceBgColor = useTiovivoStore((s) => s.workspaceBgColor)
  const setWorkspaceBgColor = useTiovivoStore((s) => s.setWorkspaceBgColor)

  useEffect(() => {
    const el = layoutRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setViewport({
        w: Math.max(320, r.width - 8),
        h: Math.max(280, r.height - 8),
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---- File processing ---- */
  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue
        const url = URL.createObjectURL(file)
        if (file.type.startsWith('video/')) {
          const v = document.createElement('video')
          v.preload = 'metadata'
          v.src = url
          await new Promise<void>((res, rej) => {
            v.onloadedmetadata = () => res()
            v.onerror = () => rej(new Error('video'))
          }).catch(() => {})
          const nw = v.videoWidth || dimensions.width * 0.5
          const nh = v.videoHeight || dimensions.height * 0.5
          URL.revokeObjectURL(url)
          addMedia(file, nw, nh)
          continue
        }
        const img = new Image()
        img.src = url
        await new Promise<void>((res, rej) => {
          img.onload = () => res()
          img.onerror = () => rej(new Error('img'))
        }).catch(() => { URL.revokeObjectURL(url) })
        addMedia(file, img.naturalWidth, img.naturalHeight)
        URL.revokeObjectURL(url)
      }
    },
    [addMedia, dimensions.height, dimensions.width],
  )

  /* ---- Canvas drag-and-drop ---- */
  const dragCounterRef = useRef(0)

  const onCanvasDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    setIsDragOver(true)
  }, [])

  const onCanvasDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragOver(false) }
  }, [])

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounterRef.current = 0
      setIsDragOver(false)
      onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  /* ---- App-internal clipboard (selected items) ---- */
  // `items` are deep copies sans id/slideId. `offsetCount` increases with each
  // successive paste so a chain of Cmd+V doesn't stack copies on top of each
  // other.
  const clipboardRef = useRef<{
    items: Omit<PlacedMedia, 'id' | 'slideId'>[]
    offsetCount: number
  } | null>(null)

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const st = useTiovivoStore.getState()

      // Undo / redo (allowed even in crop mode so user can escape).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) st.redo()
        else st.undo()
        e.preventDefault()
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        st.redo()
        e.preventDefault()
        return
      }

      // Block shortcuts during crop mode
      if (st.cropItemId) return

      // Copy selected items into the app clipboard.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (!st.selectedIds.length) return
        const selected = st.items.filter((it) => st.selectedIds.includes(it.id))
        clipboardRef.current = {
          items: selected.map(({ id: _id, slideId: _sid, ...rest }) => {
            void _id; void _sid
            return rest
          }),
          offsetCount: 1,
        }
        e.preventDefault()
        return
      }

      // Cut = copy + remove.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        if (!st.selectedIds.length) return
        const selected = st.items.filter((it) => st.selectedIds.includes(it.id))
        clipboardRef.current = {
          items: selected.map(({ id: _id, slideId: _sid, ...rest }) => {
            void _id; void _sid
            return rest
          }),
          offsetCount: 1,
        }
        st.removeItems(st.selectedIds)
        e.preventDefault()
        return
      }

      // Paste — drops clones onto the active slide with a growing offset so
      // repeated pastes don't pile on the same spot.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
        const clip = clipboardRef.current
        if (!clip || !clip.items.length) return
        const dx = 24 * clip.offsetCount
        const dy = 24 * clip.offsetCount
        const templates = clip.items.map((it) => ({
          ...it,
          x: it.x + dx,
          y: it.y + dy,
        }))
        st.pasteItems(templates)
        clip.offsetCount += 1
        e.preventDefault()
        return
      }

      // [ and ] to move selected item(s) to prev/next slide
      if ((e.key === '[' || e.key === ']') && st.selectedIds.length) {
        const primaryId = st.selectedIds[0]!
        const item = st.items.find((x) => x.id === primaryId)
        if (!item) return
        const currentIdx = st.slides.findIndex((s) => s.id === item.slideId)
        if (currentIdx < 0) return
        const targetIdx = e.key === '[' ? currentIdx - 1 : currentIdx + 1
        if (targetIdx < 0 || targetIdx >= st.slides.length) return
        const targetSlideId = st.slides[targetIdx]!.id
        st.selectedIds.forEach((id) => st.moveItemToSlide(id, targetSlideId))
        e.preventDefault()
        return
      }

      // Delete/Backspace to remove selected item(s)
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selectedIds.length) {
        st.removeItems(st.selectedIds)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // In Electron, the Edit menu's Cmd/Ctrl+Z accelerator fires before the
    // renderer sees the keydown — so also listen for IPC events from main.
    const offUndo = window.electronAPI?.onUndo(() => useTiovivoStore.getState().undo())
    const offRedo = window.electronAPI?.onRedo(() => useTiovivoStore.getState().redo())
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      offUndo?.()
      offRedo?.()
    }
  }, [])

  /* ---- Export all slides ---- */
  const exportAll = useCallback(async () => {
    const st = useTiovivoStore.getState()
    if (!st.slides.length || !stageRef.current) return
    if (!window.electronAPI) {
      console.error('[export] window.electronAPI is undefined — run inside the Electron app')
      alert('Export only works in the desktop app, not the browser.')
      return
    }
    setExporting(true)
    setExportProgress('')
    st.setSelectedIds([])
    const prefix = sanitizeFilename(exportPrefix.trim()) || 'tiovivo'
    const written: string[] = []
    let videoErrors = 0
    try {
      const dir = await window.electronAPI.pickDirectory()
      if (!dir) return

      // One-shot diagnostic dump so the user can see which encoder was
      // chosen and (importantly) why the GPU candidates were rejected.
      // Open View → Toggle Developer Tools to view. Also surface the
      // chosen encoder in the progress UI so it's visible without opening
      // dev tools.
      let chosenEncoder: string | null = null
      try {
        const diag = await window.electronAPI.getEncoderDiagnostics?.()
        if (diag) {
          chosenEncoder = diag.chosen
          console.group('[ffmpeg] encoder diagnostics')
          console.log('binary:', diag.ffmpegPath)
          console.log('compiled h264 encoders:', diag.availableH264Encoders.join(', ') || '(none)')
          console.log('chosen:', diag.chosen)
          for (const a of diag.probeAttempts) {
            console.log(
              `probe ${a.encoder}: exit=${a.exitCode}` +
              (a.stderr ? `\nstderr tail:\n${a.stderr.slice(-1500)}` : ''),
            )
          }
          console.groupEnd()
        }
      } catch (err) {
        console.warn('[ffmpeg] diagnostics unavailable:', err)
      }
      const encoderSuffix = chosenEncoder ? ` (${chosenEncoder})` : ''

      // ---- Detect source FPS for every video item ----
      // The export framerate dictates ffmpeg's input rate; if it doesn't
      // match the source, the output will be sped up / slowed down / get
      // duplicated frames. We measure each video's native rate via rVFC,
      // pick the most common as the project fps, and warn on mismatches.
      setExportProgress('Detecting video frame rates…')
      const videoFpsByItemId = new Map<string, number>()
      const videoItems = st.items.filter((it) => it.type === 'video')
      for (const it of videoItems) {
        const el = videoElements.get(it.id)
        if (!el) continue
        const fps = await detectVideoFps(el)
        if (fps && isFinite(fps)) videoFpsByItemId.set(it.id, fps)
      }

      // Decide a project-wide fps: median of detected rates, snapped to a
      // common standard rate. Falls back to 30 when nothing was detected
      // (e.g. videos still loading) so behaviour matches the previous build.
      const detectedRates = Array.from(videoFpsByItemId.values())
      let projectFps = 30
      if (detectedRates.length > 0) {
        const sorted = [...detectedRates].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]!
        projectFps = roundToCommonFps(median)
      }
      console.log(`[export] project fps = ${projectFps} (detected: ${detectedRates.map(r => r.toFixed(2)).join(', ') || 'none'})`)

      // Collect any slides whose videos disagree among themselves OR with
      // the project fps. We surface these to the user as a single combined
      // warning so they can cancel before we burn 90 s on bad output.
      const mixedReports: string[] = []
      for (let si = 0; si < st.slides.length; si++) {
        const slide = st.slides[si]!
        if (slide.exportEnabled === false) continue
        const slideVideos = videoItems.filter((it) => it.slideId === slide.id)
        const slideRates = slideVideos
          .map((it) => videoFpsByItemId.get(it.id))
          .filter((r): r is number => typeof r === 'number')
        if (slideRates.length === 0) continue
        const allMatch = slideRates.every((r) => fpsRoughlyEqual(r, projectFps))
        if (!allMatch) {
          const rounded = slideRates.map(roundToCommonFps)
          const unique = Array.from(new Set(rounded)).sort((a, b) => a - b)
          mixedReports.push(`  • Slide ${si + 1}: ${unique.join(' / ')} fps`)
        }
      }

      if (mixedReports.length > 0) {
        const proceed = window.confirm(
          `Mixed video frame rates detected.\n\n` +
          mixedReports.join('\n') +
          `\n\nExport will use ${projectFps} fps. Sources at other rates may appear ` +
          `slowed down, sped up, or have repeated frames.\n\nContinue?`,
        )
        if (!proceed) {
          setExportProgress('')
          return
        }
      }

      const pngFiles: { name: string; buffer: Uint8Array }[] = []

      for (let i = 0; i < st.slides.length; i++) {
        const slide = st.slides[i]!
        if (slide.exportEnabled === false) continue
        const slideId = slide.id
        const n = String(i + 1).padStart(2, '0')
        // Optional slide-name segment between prefix and number. Skipped
        // silently when the toggle is off or the slide has no custom name
        // → no `Slide_1` filler segments, no filename collisions.
        const slideNameSeg = includeSlideNameInFilename && slide.name?.trim()
          ? `_${sanitizeFilenameSegment(slide.name.trim())}`
          : ''
        const hasVideo = st.items.some((it) => it.slideId === slideId && it.type === 'video')

        if (hasVideo) {
          // Video slide → export as MP4
          setExportProgress(`Encoding slide ${i + 1} video${encoderSuffix}...`)
          const filename = `${prefix}${slideNameSeg}_${n}.mp4`
          const outputPath = `${dir}/${filename}`
          try {
            const result = await stageRef.current!.exportSlideVideo(
              slideId,
              outputPath,
              projectFps,
              (pct) => setExportProgress(`Encoding slide ${i + 1}: ${Math.round(pct)}%${encoderSuffix}`),
              (dataUrl) => setExportPreview(dataUrl),
            )
            if (result) written.push(filename)
            else videoErrors++
          } catch (err) {
            videoErrors++
            console.error(`[export] video slide ${i + 1} failed:`, err)
          }
        } else {
          // Image slide → export as PNG
          setExportProgress(`Exporting slide ${i + 1}...`)
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          )
          const blob = await stageRef.current!.exportSlidePng(slideId)
          if (blob) {
            const filename = `${prefix}${slideNameSeg}_${n}.png`
            pngFiles.push({
              name: filename,
              buffer: new Uint8Array(await blob.arrayBuffer()),
            })
            written.push(filename)
          }
        }
      }

      if (pngFiles.length > 0) {
        await window.electronAPI.saveFilesToDir({ dirPath: dir, files: pngFiles })
      }
      console.log(`[export] wrote ${written.length} file(s) to ${dir}`, written)
      if (videoErrors > 0) {
        alert(
          `Exported ${written.length} file(s) to:\n${dir}\n\n` +
          `${videoErrors} video slide(s) failed. Check the dev console (View → Toggle Developer Tools) for details.`,
        )
      } else if (written.length > 0) {
        alert(`Exported ${written.length} file(s) to:\n${dir}`)
      } else {
        alert(`Nothing was exported. The slide list is empty or every slide failed.`)
      }
    } catch (err) {
      console.error('[export] failed:', err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [exportPrefix, includeSlideNameInFilename])

  /* ---- Export a single slide on demand (per-slide export button) ---- */
  const exportSingleSlide = useCallback(async (slideId: string) => {
    const st = useTiovivoStore.getState()
    if (!stageRef.current) return
    if (!window.electronAPI) {
      alert('Export only works in the desktop app, not the browser.')
      return
    }
    const idx = st.slides.findIndex((s) => s.id === slideId)
    if (idx < 0) return
    const slide = st.slides[idx]!
    const prefix = sanitizeFilename(exportPrefix.trim()) || 'tiovivo'
    const n = String(idx + 1).padStart(2, '0')
    const slideNameSeg = includeSlideNameInFilename && slide.name?.trim()
      ? `_${sanitizeFilenameSegment(slide.name.trim())}`
      : ''
    const hasVideo = st.items.some((it) => it.slideId === slideId && it.type === 'video')
    setExporting(true)
    setExportProgress(`Exporting slide ${idx + 1}...`)
    st.setSelectedIds([])
    try {
      if (hasVideo) {
        const defaultName = `${prefix}${slideNameSeg}_${n}.mp4`
        const outputPath = await window.electronAPI.saveFile({
          defaultName,
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        })
        if (!outputPath) return
        // Detect fps for the videos on this slide so the single-slide
        // export honours the same fps-from-source heuristic as Export all.
        const slideVideoItems = st.items.filter((it) => it.slideId === slideId && it.type === 'video')
        const detectedRates: number[] = []
        for (const it of slideVideoItems) {
          const el = videoElements.get(it.id)
          if (!el) continue
          const fps = await detectVideoFps(el)
          if (fps && isFinite(fps)) detectedRates.push(fps)
        }
        let slideFps = 30
        if (detectedRates.length > 0) {
          const sorted = [...detectedRates].sort((a, b) => a - b)
          slideFps = roundToCommonFps(sorted[Math.floor(sorted.length / 2)]!)
        }
        setExportProgress(`Encoding slide ${idx + 1}: 0%`)
        const result = await stageRef.current.exportSlideVideo(
          slideId,
          outputPath,
          slideFps,
          (pct) => setExportProgress(`Encoding slide ${idx + 1}: ${Math.round(pct)}%`),
          (dataUrl) => setExportPreview(dataUrl),
        )
        if (!result) alert('Video export failed. Check the dev console for details.')
      } else {
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        )
        const blob = await stageRef.current.exportSlidePng(slideId)
        if (!blob) {
          alert('Export failed.')
          return
        }
        const defaultName = `${prefix}${slideNameSeg}_${n}.png`
        const buffer = new Uint8Array(await blob.arrayBuffer())
        const path = await window.electronAPI.saveFile({
          defaultName,
          filters: [{ name: 'PNG image', extensions: ['png'] }],
          buffer,
        })
        if (path) console.log(`[export] wrote ${path}`)
      }
    } catch (err) {
      console.error('[export-single] failed:', err)
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [exportPrefix, includeSlideNameInFilename])

  /* ---- Save / Open project ---- */
  // Returns true when the project was actually written to disk, false if the
  // user cancelled the file dialog or save failed. The close-orchestration
  // path uses the boolean to decide whether to proceed with closing the window.
  const handleSave = useCallback(async (forcePrompt: boolean): Promise<boolean> => {
    if (!window.electronAPI) {
      alert('Saving projects only works in the desktop app, not the browser.')
      return false
    }
    const st = useTiovivoStore.getState()
    try {
      // Render the Fit-view snapshot (all slides side-by-side) so the .vpost
      // carries its own preview image. Failure here is non-fatal — we still
      // save the project, just without the embedded preview.
      const preview = await generateProjectPreview(
        st.slides,
        st.items,
        st.dimensions,
        st.workspaceBgColor,
      ).catch((err) => {
        console.warn('[save] preview generation failed:', err)
        return null
      })

      const blob = await serializeProject(
        {
          slides: st.slides,
          items: st.items,
          dimensions: st.dimensions,
          presetId: st.presetId,
          customWidth: st.customWidth,
          customHeight: st.customHeight,
          workspaceBgColor: st.workspaceBgColor,
          preview,
          guides: {
            showGrid: st.showGrid,
            gridSize: st.gridSize,
            gridOpacity: st.gridOpacity,
            showCenterGuides: st.showCenterGuides,
            seamlessSlides: st.seamlessSlides,
            showHiddenZone: st.showHiddenZone,
            marginPct: st.marginPct,
            snapGrid: st.snapGrid,
            snapCenter: st.snapCenter,
            snapItems: st.snapItems,
            snapMargins: st.snapMargins,
          },
          lastTextStyle: st.lastTextStyle,
        },
        async (src) => (await fetch(src)).blob(),
      )
      const buffer = new Uint8Array(await blob.arrayBuffer())

      const existing = projectPathRef.current
      if (existing && !forcePrompt) {
        await window.electronAPI.writeFile({ path: existing, buffer })
        useTiovivoStore.getState().setDirty(false)
        void refreshRecents()
        return true
      }

      const defaultName = existing
        ? existing.split(/[/\\]/).pop() || 'Untitled.vpost'
        : 'Untitled.vpost'
      const path = await window.electronAPI.saveFile({
        defaultName,
        filters: VPOST_FILTER,
        buffer,
      })
      if (path) {
        setProjectPath(path)
        useTiovivoStore.getState().setDirty(false)
        void refreshRecents()
        return true
      }
      // User cancelled the file picker — leave isDirty alone, signal caller
      // so the close-orchestration path keeps the window open.
      return false
    } catch (err) {
      console.error('[save] failed:', err)
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }, [refreshRecents])

  const loadFromBuffer = useCallback((buffer: Uint8Array, path: string) => {
    try {
      const { manifest, assetBlobs } = deserializeProject(buffer)
      const assetUrls = new Map<string, string>()
      for (const [id, blob] of assetBlobs) {
        assetUrls.set(id, URL.createObjectURL(blob))
      }
      const items = hydrateItems(manifest, assetUrls)
      useTiovivoStore.getState().loadProjectState({
        slides: manifest.slides,
        items,
        dimensions: manifest.dimensions,
        presetId: manifest.presetId,
        customWidth: manifest.customWidth,
        customHeight: manifest.customHeight,
        workspaceBgColor: manifest.workspaceBgColor,
        guides: manifest.guides,
        lastTextStyle: manifest.lastTextStyle,
      })
      setProjectPath(path)
    } catch (err) {
      console.error('[open] failed:', err)
      alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  const handleOpen = useCallback(async () => {
    if (!window.electronAPI) {
      alert('Opening projects only works in the desktop app, not the browser.')
      return
    }
    try {
      const result = await window.electronAPI.openFile({ filters: VPOST_FILTER })
      if (!result) return
      loadFromBuffer(result.buffer, result.path)
      void refreshRecents()
    } catch (err) {
      console.error('[open] failed:', err)
      alert(`Open failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [loadFromBuffer, refreshRecents])

  const handleNew = useCallback(() => {
    if (!window.confirm('Discard current project and start fresh?')) return
    useTiovivoStore.getState().resetProject()
    setProjectPath(null)
  }, [])

  /* ---- File-menu keyboard shortcuts ---- */
  // On macOS the native menu's accelerators (Cmd+N / O / S / Shift+S) fire
  // these flows via IPC. On Windows / Linux we removed the native menu in
  // favour of the in-app MenuBar, so we wire the same shortcuts manually
  // here. Skip on Mac to avoid double-firing.
  useEffect(() => {
    if (/Mac/.test(navigator.userAgent)) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault(); handleNew()
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault(); handleOpen()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); handleSave(e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNew, handleOpen, handleSave])

  /* ---- Wire File menu IPC + window title ---- */
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    const offNew = api.onNewProject(() => handleNew())
    const offOpen = api.onOpenProject(() => handleOpen())
    const offSave = api.onSaveProject(() => handleSave(false))
    const offSaveAs = api.onSaveProjectAs(() => handleSave(true))
    const offOpenFile = api.onOpenProjectFile(({ path, buffer }) => {
      loadFromBuffer(buffer, path)
      // Main has already pushed this path onto the recents list; sync the
      // in-app MenuBar so the next File → Open Recent reflects it (no-op on
      // mac, where refreshRecents short-circuits).
      void refreshRecents()
    })
    // Save-on-quit orchestration. Main asks if we're dirty (with a 1.5s
    // timeout on its side, so respond synchronously from the store snapshot).
    const offQueryDirty = api.onQueryDirty?.(() => {
      api.sendDirtyResponse(useTiovivoStore.getState().isDirty)
    })
    // Main asked us to save and report whether the save actually happened.
    // handleSave returns false on file-picker cancel or write failure — in
    // either case main keeps the window open.
    const offSaveAndClose = api.onSaveAndClose?.(() => {
      handleSave(false).then((ok) => api.sendSaveResult(ok))
    })
    return () => {
      offNew?.()
      offOpen?.()
      offSave?.()
      offSaveAs?.()
      offOpenFile?.()
      offQueryDirty?.()
      offSaveAndClose?.()
    }
  }, [handleNew, handleOpen, handleSave, loadFromBuffer, refreshRecents])

  useEffect(() => {
    // Cross-platform basename split: on Windows, paths use backslashes — splitting
    // only on '/' there leaves the entire path in the export prefix.
    const base = projectPath ? projectPath.split(/[/\\]/).pop() : null
    document.title = base ? `${base} — Tiovivo` : 'Tiovivo'
    if (base) {
      // Default the export prefix to the project file basename without extension.
      const stem = base.replace(/\.vpost$/i, '')
      setExportPrefix(stem)
    }
  }, [projectPath])

  /* ---- Active slide indicator ---- */
  const activeSlideIndex = slides.findIndex((s) => s.id === activeSlideId)

  /* ---- Text selection (for properties panel) ---- */
  const selectedTextItem: PlacedMedia | null = useMemo(() => {
    if (selectedIds.length !== 1) return null
    const it = items.find((x) => x.id === selectedIds[0])
    return it && it.type === 'text' ? it : null
  }, [selectedIds, items])

  /** Single media (image / video / gif) selection — enables the "Sample from
   *  Media" button in the Background panel. Null when nothing or multiple
   *  things are selected. */
  const selectedMediaItem: PlacedMedia | null = useMemo(() => {
    if (selectedIds.length !== 1) return null
    const it = items.find((x) => x.id === selectedIds[0])
    if (!it) return null
    return (it.type === 'image' || it.type === 'video' || it.type === 'gif') ? it : null
  }, [selectedIds, items])

  const refreshFonts = useCallback(async () => {
    try {
      const list = await listSystemFonts()
      if (list.length) setFontList(list)
    } catch {
      // already falls back inside listSystemFonts
    }
  }, [])

  const onAddText = useCallback(() => {
    addText()
    // Trigger font enumeration on the user gesture (queryLocalFonts requires
    // a transient activation).
    void refreshFonts()
  }, [addText, refreshFonts])

  return (
    <div className="app">
      {/* In-app menu bar for Windows / Linux. CSS hides it on macOS — Mac
          uses the native menu strip at the top of the screen instead. */}
      <MenuBar
        recents={recents}
        onNew={handleNew}
        onOpen={handleOpen}
        onOpenRecent={(p) => {
          // Main reads the file and sends app:open-project-file back to us;
          // loadFromBuffer is wired to that channel via the existing useEffect.
          window.electronAPI?.openRecent(p)
        }}
        onClearRecents={() => {
          void window.electronAPI?.clearRecents()
          setRecents([])
        }}
        onSave={() => { void handleSave(false) }}
        onSaveAs={() => { void handleSave(true) }}
        onUndo={() => useTiovivoStore.getState().undo()}
        onRedo={() => useTiovivoStore.getState().redo()}
        onReload={() => location.reload()}
        onToggleDevTools={() => {
          // No IPC for this yet; rely on the F12 / Ctrl+Shift+I native
          // accelerator Chromium still honours. The menu item exists as a
          // discoverability hint.
        }}
      />
      <header className="app__header">
        <div className="app__brand">
          <img className="app__brand-mark" src={appIconUrl} alt="" aria-hidden />
          <span className="app__brand-title">Tiovivo</span>
        </div>
        <div className="app__brand-sep" aria-hidden />
        <div className="app__presets">
          {(
            [
              ['hd', '16:9'],
              ['1:1', '1:1'],
              ['4:5', '4:5'],
              ['3:4', '3:4'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${presetId === id ? 'btn--accent' : ''}`}
              onClick={() => setPreset(id)}
              title={`${PRESETS[id].width} × ${PRESETS[id].height}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`btn ${presetId === 'custom' ? 'btn--accent' : ''}`}
            onClick={() => setPreset('custom')}
          >
            Custom
          </button>
        </div>
        <div className="app__custom-size">
          <label>
            W
            <NumberField
              min={64}
              max={8192}
              // Bind to the live dimensions, not the cached customWidth — that
              // field doesn't update when the user clicks a preset, so the
              // input would stay stale. setCustomDimensions still flips the
              // preset to "custom" as a side effect of typing here.
              value={dimensions.width}
              scrubStep={1}
              onCommit={(w) => {
                if (lockAspect) {
                  const aspect = dimensions.width / Math.max(1, dimensions.height)
                  const h = Math.max(64, Math.round(w / aspect))
                  setCustomDimensions(w, h)
                } else {
                  setCustomDimensions(w, dimensions.height)
                }
              }}
            />
          </label>
          {/* Aspect-lock toggle between W and H. When locked, editing one
              dimension scales the other from the current aspect ratio. */}
          <button
            type="button"
            className={`app__aspect-lock ${lockAspect ? 'app__aspect-lock--locked' : ''}`}
            onClick={() => setLockAspect((v) => !v)}
            title={lockAspect ? 'Aspect ratio locked — click to unlock' : 'Lock aspect ratio'}
            aria-pressed={lockAspect}
          >
            {lockAspect
              ? <Icon.Link style={{ width: 12, height: 12 }} />
              : <Icon.LinkOff style={{ width: 12, height: 12 }} />}
          </button>
          <label>
            H
            <NumberField
              min={64}
              max={8192}
              value={dimensions.height}
              scrubStep={1}
              onCommit={(h) => {
                if (lockAspect) {
                  const aspect = dimensions.width / Math.max(1, dimensions.height)
                  const w = Math.max(64, Math.round(h * aspect))
                  setCustomDimensions(w, h)
                } else {
                  setCustomDimensions(dimensions.width, h)
                }
              }}
            />
          </label>
        </div>
        <div className="app__spacer" />
        {/* Workspace pasteboard colour — lives in the header because it's a
            global view setting, not per-slide. Same pill shape as the export
            name input so it sits cleanly in the row. The reset button is
            always rendered (hidden via visibility, not display) so the pill
            keeps a stable width — changing the colour doesn't shift the
            Name input next to it. */}
        {(() => {
          const isWorkspaceDefault =
            !workspaceBgColor || workspaceBgColor.toLowerCase() === '#0a0a0e'
          return (
            <label
              className="app__header-pill"
              title="Workspace background — pasteboard colour around the slides"
            >
              <input
                className="color-swatch"
                type="color"
                value={workspaceBgColor || '#0a0a0e'}
                onChange={(e) => setWorkspaceBgColor(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={(e) => { e.preventDefault(); setWorkspaceBgColor('#0a0a0e') }}
                title={isWorkspaceDefault ? 'Workspace already at default' : 'Reset workspace colour'}
                style={{
                  padding: '2px 6px',
                  flexDirection: 'row',
                  gap: 4,
                  // Stay visible at all times so the pill width never shifts.
                  // Idle (= already default) reads as a quiet placeholder
                  // barely above the pill background; once a custom colour
                  // is picked it brightens to the normal ghost-btn tone so
                  // the affordance becomes obvious.
                  color: isWorkspaceDefault
                    ? 'rgba(255, 255, 255, 0.18)'
                    : 'rgba(255, 255, 255, 0.55)',
                  transition: 'color var(--dur-fast) var(--ease)',
                }}
              >
                <Icon.Reset style={{ width: 10, height: 10 }} />
              </button>
            </label>
          )
        })()}
        <label
          className="app__export-name"
          title="Filename prefix used for exported PNGs/MP4s. Defaults to the project name."
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 8px',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.03)',
            height: 32,
          }}
        >
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Name</span>
          <input
            type="text"
            value={exportPrefix}
            onChange={(e) => setExportPrefix(e.target.value)}
            placeholder="tiovivo"
            spellCheck={false}
            style={{
              width: 120,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: '#fff',
              fontSize: 13,
              fontFamily: 'inherit',
            }}
          />
          {/* Filename-format hint doubles as the Slide-names toggle. Always
              renders with a visible border + chevron so it reads as a button
              even when inactive; the active state takes the same blue tint
              as our segmented toggles for consistency. */}
          <button
            type="button"
            className={`app__filename-toggle ${includeSlideNameInFilename ? 'app__filename-toggle--on' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              setIncludeSlideNameInFilename((v) => !v)
            }}
            // Stop the parent <label> from re-focusing the input on click.
            onMouseDown={(e) => e.preventDefault()}
            title={
              includeSlideNameInFilename
                ? 'Slide names included in filename — click to remove'
                : 'Click to include each slide\'s name in its export filename'
            }
          >
            {includeSlideNameInFilename ? '_SLIDE_NN' : '_NN'}
          </button>
        </label>
        <button
          type="button"
          className="btn btn--export"
          disabled={exporting}
          onClick={exportAll}
        >
          <Icon.Export />
          {exporting ? 'Exporting…' : 'Export all'}
        </button>
      </header>

      <div className="app__body">
        <aside className="app__sidebar">
          <input
            ref={addMediaInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files
              onFiles(files)
              if (e.target) e.target.value = ''
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => addMediaInputRef.current?.click()}
              title="Add images or videos"
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: '7px 12px',
                fontSize: '0.78rem',
                justifyContent: 'center',
                flex: 1,
              }}
            >
              <Icon.Plus style={{ width: 13, height: 13 }} />
              Add media
            </button>
            <button
              type="button"
              className="btn btn--outline"
              onClick={onAddText}
              title="Add a text layer"
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: '7px 12px',
                fontSize: '0.78rem',
                justifyContent: 'center',
                flex: 1,
              }}
            >
              <Icon.Text style={{ width: 13, height: 13 }} />
              Add text
            </button>
          </div>

          <details className="collapsible" open>
            <summary><h2><Icon.Sliders />Background</h2></summary>
            <div className="collapsible__body">
              <BackgroundPanel
                slides={slides}
                activeSlideId={activeSlideId}
                selectedMediaItem={selectedMediaItem}
                setAllSlidesBgVibe={setAllSlidesBgVibe}
                setSlideBgVibe={setSlideBgVibe}
                randomizeAllSlideVibes={randomizeAllSlideVibes}
                randomizeSlideVibe={randomizeSlideVibe}
              />
            </div>
          </details>

          <details className="collapsible" open>
            <summary><h2><Icon.Grid />Guides & snap</h2></summary>
            <div className="collapsible__body">
              <label className="check">
                <input type="checkbox" checked={seamlessSlides} onChange={(e) => setSeamlessSlides(e.target.checked)} />
                Seamless slides
              </label>
              <label className="check">
                <input type="checkbox" checked={showHiddenZone} onChange={(e) => setShowHiddenZone(e.target.checked)} />
                Hidden zone
              </label>
              <hr />
              <label className="check">
                <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                Grid
              </label>
              <label className="field">
                <span>Grid px</span>
                <NumberField
                  min={4}
                  max={400}
                  value={gridSize}
                  onCommit={(n) => setGridSize(n)}
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                />
              </label>
              <label className="slider-field" title="Visibility of the grid overlay on top of media">
                <span className="slider-field__label">
                  Grid opacity<span className="slider-field__value">{Math.round(gridOpacity * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gridOpacity}
                  style={sliderFill(gridOpacity, 0, 1)}
                  onChange={(e) => setGridOpacity(Number(e.target.value))}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={showCenterGuides} onChange={(e) => setShowCenterGuides(e.target.checked)} />
                Center lines
              </label>
              <hr />
              <label className="check">
                <input type="checkbox" checked={snapGrid} onChange={(e) => setSnapGrid(e.target.checked)} />
                Snap to grid
              </label>
              <label className="check">
                <input type="checkbox" checked={snapCenter} onChange={(e) => setSnapCenter(e.target.checked)} />
                Snap to center
              </label>
              <label className="check">
                <input type="checkbox" checked={snapItems} onChange={(e) => setSnapItems(e.target.checked)} />
                Snap to other media
              </label>
              <label className="check">
                <input type="checkbox" checked={snapMargins} onChange={(e) => setSnapMargins(e.target.checked)} />
                Snap to margins
              </label>
            </div>
          </details>

          {selectedTextItem && (() => {
            const t = selectedTextItem
            const patch = (p: Partial<PlacedMedia>) => updateItem(t.id, p)
            const align: TextAlign = (t.textAlign as TextAlign) || 'left'
            return (
              <details className="collapsible" open>
                <summary><h2><Icon.Text />Text</h2></summary>
                <div className="collapsible__body">
                  <label className="field">
                    <span>Content</span>
                    <textarea
                      value={t.text || ''}
                      onChange={(e) => patch({ text: e.target.value })}
                      spellCheck={false}
                      rows={3}
                      style={{ resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  </label>

                  <label className="field">
                    <span>Font</span>
                    <input
                      type="text"
                      list="app-system-fonts"
                      value={t.fontFamily ?? ''}
                      onChange={(e) => patch({ fontFamily: e.target.value })}
                      onFocus={() => void refreshFonts()}
                      spellCheck={false}
                      placeholder="Inter"
                    />
                    <datalist id="app-system-fonts">
                      {fontList.map((f) => <option key={f} value={f} />)}
                    </datalist>
                  </label>

                  <label className="check" title="When on, font size grows or shrinks so the text fills the box width × height.">
                    <input
                      type="checkbox"
                      checked={!!t.fillMode}
                      onChange={(e) => patch({ fillMode: e.target.checked })}
                    />
                    Fill box (auto-size)
                  </label>

                  <div className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <label
                      style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}
                      title={t.fillMode ? 'Disabled — size is computed from the box dimensions while Fill is on.' : undefined}
                    >
                      <span>Size{t.fillMode ? ' (auto)' : ''}</span>
                      <NumberField
                        min={4}
                        max={2000}
                        value={Math.round(t.fontSize || 64)}
                        onCommit={(n) => patch({ fontSize: n })}
                        style={{
                          width: '100%',
                          minWidth: 0,
                          boxSizing: 'border-box',
                          opacity: t.fillMode ? 0.5 : 1,
                          pointerEvents: t.fillMode ? 'none' : 'auto',
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                      <span>Line height</span>
                      <NumberField
                        step={0.05}
                        min={0.6}
                        max={4}
                        decimals={2}
                        value={t.lineHeight ?? 1.15}
                        onCommit={(n) => patch({ lineHeight: n })}
                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                      />
                    </label>
                  </div>

                  <div className="field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                      <span>Letter spacing</span>
                      <NumberField
                        step={0.5}
                        decimals={1}
                        value={t.letterSpacing ?? 0}
                        onCommit={(n) => patch({ letterSpacing: n })}
                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                      />
                    </label>
                    <label
                      style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}
                      title="Width of the text box. Text wraps to a new line when a word would extend past this width. Same as dragging the side handles on the canvas."
                    >
                      <span>Box width</span>
                      <NumberField
                        min={20}
                        value={Math.round(t.width)}
                        onCommit={(n) => patch({ width: n })}
                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                      />
                    </label>
                  </div>

                  {t.fillMode && (
                    <label
                      className="field"
                      title="Height of the text box. Font grows to fill this height while keeping word-wrap inside the box width."
                    >
                      <span>Box height</span>
                      <NumberField
                        min={20}
                        value={Math.round(t.height)}
                        onCommit={(n) => patch({ height: n })}
                        style={{ width: '100%', minWidth: 0, boxSizing: 'border-box' }}
                      />
                    </label>
                  )}

                  <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className={`btn btn--sm ${t.bold ? 'btn--accent' : ''}`}
                      style={{ fontWeight: 700 }}
                      onClick={() => patch({ bold: !t.bold })}
                      title="Bold"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm ${t.italic ? 'btn--accent' : ''}`}
                      style={{ fontStyle: 'italic' }}
                      onClick={() => patch({ italic: !t.italic })}
                      title="Italic"
                    >
                      I
                    </button>
                    <div style={{ flex: 1 }} />
                    {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`btn btn--sm ${align === a ? 'btn--accent' : ''}`}
                        onClick={() => patch({ textAlign: a })}
                        title={`Align ${a}`}
                      >
                        {a === 'left' ? '⯇' : a === 'center' ? '≡' : a === 'right' ? '⯈' : '☰'}
                      </button>
                    ))}
                  </div>

                  <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <span>Color</span>
                    <input
                      className="color-swatch"
                      type="color"
                      value={t.textColor || '#ffffff'}
                      onChange={(e) => patch({ textColor: e.target.value })}
                    />
                    <span className="field__value">
                      {t.textColor || '#ffffff'}
                    </span>
                  </label>
                </div>
              </details>
            )
          })()}

          {selectedIds.length > 0 && (() => {
            const count = selectedIds.length
            const singleId = count === 1 ? selectedIds[0]! : null
            const singleOk = singleId ? !!items.find((x) => x.id === singleId) : false
            if (singleId && !singleOk) return null
            return (
              <div className="selection-panel">
                <h2><Icon.Target />{count > 1 ? `Selection (${count})` : 'Selection'}</h2>
                <button
                  type="button"
                  className="btn btn--ghost btn--danger btn--sm"
                  style={{ marginTop: 10, alignSelf: 'flex-start', gap: 6, flexDirection: 'row' }}
                  onClick={() => {
                    if (count > 1) removeItems(selectedIds)
                    else if (singleId) removeItem(singleId)
                  }}
                >
                  <Icon.Trash style={{ width: 11, height: 11 }} />
                  {count > 1 ? `Remove ${count} items` : 'Remove media'}
                </button>
              </div>
            )
          })()}
        </aside>

        <main className="app__main">
          <div
            className="app__canvas-host"
            ref={layoutRef}
            style={{ flex: 1, minHeight: 0, position: 'relative' }}
            onDragEnter={onCanvasDragEnter}
            onDragLeave={onCanvasDragLeave}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
          >
            {isDragOver && (
              <div className="drop-overlay">
                <div className="drop-overlay__content">
                  <span className="drop-overlay__icon">
                    <Icon.Plus />
                  </span>
                  <span>
                    Drop to add to
                    <span className="drop-overlay__slide">Slide {activeSlideIndex + 1}</span>
                  </span>
                </div>
              </div>
            )}
            <EditorStage
              ref={stageRef}
              maxViewWidth={viewport.w}
              maxViewHeight={viewport.h}
              onExportSingleSlide={exportSingleSlide}
            />

            {/* Export veil — hides the canvas's necessary-but-jarring
                visual gymnastics during export (the stage transform is
                reset to 1:1 origin so toCanvas can grab world-coord
                pixels; videos seek/draw frame-by-frame as we capture).
                Konva keeps rendering underneath, the user just doesn't
                see the camera snap around. */}
            {exporting && (
              <div
                className="app__export-veil"
                style={{ background: workspaceBgColor || '#0a0a0e' }}
                aria-hidden
              >
                {exportPreview && (
                  <img
                    src={exportPreview}
                    alt=""
                    className="app__export-veil-img"
                  />
                )}
              </div>
            )}

            {/* Export status toast — pinned to the top-right of the canvas
                area so it can grow as long as ffmpeg's progress string
                wants without disturbing the header layout. */}
            {exporting && (
              <div
                className="app__export-toast"
                aria-live="polite"
                title={exportProgress}
              >
                <span className="app__export-toast-dot" aria-hidden />
                <span className="app__export-toast-text">
                  {exportProgress || 'Working'}
                  {exportElapsed ? ` · ${exportElapsed}` : ''}
                  {'.'.repeat(exportPulse)}
                </span>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
