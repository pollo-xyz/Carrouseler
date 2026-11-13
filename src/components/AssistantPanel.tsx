import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiStatus } from '../electron'
import { useTiovivoStore } from '../store/useTiovivoStore'
import type { PlacedMedia } from '../store/useTiovivoStore'
import { PRESETS } from '../lib/presets'
import type { PresetId } from '../lib/presets'
import { toast } from '../lib/feedback'

type Preset = Exclude<PresetId, 'custom'>
type Task = 'create' | 'review' | 'hooks' | 'captions' | 'reformat'

const TASKS: { id: Task; label: string; blurb: string }[] = [
  { id: 'create', label: 'Create', blurb: 'A new carousel from a brief, an article, a script or a link.' },
  { id: 'review', label: 'Review', blurb: 'A critique of the open deck, with one-click fixes.' },
  { id: 'hooks', label: 'Hooks', blurb: 'Ten alternative headlines for slide 1.' },
  { id: 'captions', label: 'Captions', blurb: 'Caption, hashtags, first comment and alt text.' },
  { id: 'reformat', label: 'Repurpose', blurb: 'The same deck re-laid out for another format.' },
]

const FORMAT_NAMES: Record<Preset, string> = {
  '4:5': 'Post 4:5', '3:4': 'Tall 3:4', '1:1': 'Square', '9:16': 'Vertical 9:16', hd: 'Wide 16:9',
}

interface Fix {
  id: string
  text: string | null
  x: number | null
  y: number | null
  width: number | null
  fontSize: number | null
  textColor: string | null
  lineHeight: number | null
}
interface Finding {
  slide: number
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  fix: Fix[]
}
interface Review { summary: string; findings: Finding[] }
interface Hooks { hooks: { headline: string; angle: string }[] }
interface Captions {
  instagram: { caption: string; hashtags: string[]; firstComment: string }
  tiktok: { caption: string; hashtags: string[] }
  altText: { slide: number; text: string }[]
}

const tags = (list: string[]) => list.map((t) => `#${t.replace(/^#/, '')}`).join(' ')

async function copy(text: string, what: string) {
  const ok = await window.electronAPI?.copyText?.(text).catch(() => false)
  toast(ok ? `${what} copied.` : 'Could not copy.', { kind: ok ? 'success' : 'error' })
}

/** Apply a review fix: only the fields the reviewer set, only on items that
 *  still exist. One undo step per finding. */
function applyFix(fix: Fix[]): number {
  const st = useTiovivoStore.getState()
  const patches: { id: string; patch: Partial<PlacedMedia> }[] = []
  for (const f of fix) {
    const item = st.items.find((i) => i.id === f.id)
    if (!item) continue
    const patch: Partial<PlacedMedia> = {}
    if (f.x !== null) patch.x = f.x
    if (f.y !== null) patch.y = f.y
    if (f.width !== null && f.width > 0) patch.width = f.width
    if (item.type === 'text') {
      if (f.text !== null) patch.text = f.text
      if (f.fontSize !== null && f.fontSize > 0) patch.fontSize = f.fontSize
      if (f.textColor !== null && /^#[0-9a-f]{6}$/i.test(f.textColor)) patch.textColor = f.textColor
      if (f.lineHeight !== null && f.lineHeight > 0) patch.lineHeight = f.lineHeight
    }
    if (Object.keys(patch).length) patches.push({ id: item.id, patch })
  }
  if (patches.length) st.updateItems(patches)
  return patches.length
}

interface Props {
  onClose: () => void
  /** Replace the document with a blank one in this format (asks about
   *  unsaved work). False = the person kept their document. */
  startBlank: (preset: Preset) => Promise<boolean>
  /** Forget the file the document came from, so edits can't overwrite it. */
  detachFromFile: () => void
  onFocusSlide: (slideId: string) => void
}

export default function AssistantPanel({ onClose, startBlank, detachFromFile, onFocusSlide }: Props) {
  const api = window.electronAPI
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [task, setTask] = useState<Task>('create')
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runIdRef = useRef<string | null>(null)

  // Create
  const [brief, setBrief] = useState('')
  const [format, setFormat] = useState<Preset>('4:5')
  const [count, setCount] = useState<number | 'auto'>('auto')
  // Repurpose
  const presetId = useTiovivoStore((s) => s.presetId)
  const [target, setTarget] = useState<Preset>('9:16')
  const [animate, setAnimate] = useState(true)
  // Results
  const [summary, setSummary] = useState<Partial<Record<Task, string>>>({})
  const [review, setReview] = useState<Review | null>(null)
  const [fixed, setFixed] = useState<Set<number>>(new Set())
  const [hooks, setHooks] = useState<Hooks | null>(null)
  const [usedHook, setUsedHook] = useState<number | null>(null)
  const [captions, setCaptions] = useState<Captions | null>(null)

  useEffect(() => {
    void api?.aiStatus?.().then(setStatus)
    return api?.onAiProgress?.(({ runId, line }) => {
      if (runId === runIdRef.current) setLines((prev) => [...prev.slice(-40), line])
    })
  }, [api])

  const run = useCallback(async <T,>(which: Task, params: Record<string, unknown>): Promise<T | null> => {
    if (!api?.aiRun) return null
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    setBusy(true)
    setError(null)
    setLines([])
    try {
      const res = await api.aiRun({ runId, task: which, params })
      if (res.ok) return res.result as T
      if (!res.cancelled) setError(res.error ?? 'Something went wrong.')
      return null
    } finally {
      setBusy(false)
      runIdRef.current = null
    }
  }, [api])

  const stop = () => { if (runIdRef.current) void api?.aiCancel?.(runIdRef.current) }

  const go = async () => {
    if (task === 'create') {
      if (!brief.trim()) { setError('Say what the post is about first.'); return }
      if (!(await startBlank(format))) return
      const r = await run<{ summary: string }>('create', { brief, slides: count === 'auto' ? undefined : count })
      if (r) setSummary((s) => ({ ...s, create: r.summary }))
    } else if (task === 'reformat') {
      // Work on a copy: the saved file keeps the original layout.
      detachFromFile()
      const r = await run<{ summary: string }>('reformat', { preset: target, animate })
      if (r) setSummary((s) => ({ ...s, reformat: r.summary }))
    } else if (task === 'review') {
      const r = await run<Review>('review', {})
      if (r) { setReview(r); setFixed(new Set()) }
    } else if (task === 'hooks') {
      const r = await run<Hooks>('hooks', {})
      if (r) { setHooks(r); setUsedHook(null) }
    } else {
      const r = await run<Captions>('captions', {})
      if (r) setCaptions(r)
    }
  }

  const applyHook = (i: number, headline: string) => {
    const st = useTiovivoStore.getState()
    const first = st.slides[0]
    const texts = st.items.filter((it) => it.type === 'text' && it.slideId === first?.id && !it.appearsOnAllSlides)
    if (!first || texts.length === 0) { toast('Slide 1 has no text to replace.', { kind: 'error' }); return }
    const headlineItem = texts.reduce((a, b) => ((b.fontSize ?? 0) > (a.fontSize ?? 0) ? b : a))
    st.updateItem(headlineItem.id, { text: headline })
    st.setActiveSlide(first.id)
    onFocusSlide(first.id)
    setUsedHook(i)
  }

  const fixOne = (i: number, f: Finding) => {
    if (applyFix(f.fix) === 0) toast('Those items have changed since the review. Run it again.', { kind: 'error' })
    setFixed((prev) => new Set(prev).add(i))
  }

  const goToSlide = (n: number) => {
    const slide = useTiovivoStore.getState().slides[n - 1]
    if (!slide) return
    useTiovivoStore.getState().setActiveSlide(slide.id)
    onFocusSlide(slide.id)
  }

  const current = TASKS.find((t) => t.id === task)!
  const fixable = review ? review.findings.map((f, i) => ({ f, i })).filter(({ f, i }) => f.fix.length > 0 && !fixed.has(i)) : []
  const formats = (Object.keys(PRESETS) as Preset[])

  return (
    <aside
      className="assistant"
      aria-label="Assistant"
      // Typing here must not reach the canvas shortcuts (Backspace deletes items).
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="assistant__head">
        <h2>Assistant</h2>
        <button type="button" className="btn btn--sm" onClick={onClose}>Close</button>
      </header>

      {!api?.aiStatus ? (
        <p className="assistant__note">The assistant works in the desktop app, not the browser.</p>
      ) : !status ? (
        <p className="assistant__note">Loading…</p>
      ) : !status.source ? (
        <div className="assistant__body">
          <p className="assistant__note">
            The assistant is Claude working on your deck. It needs an Anthropic API key, which you create at
            console.anthropic.com. Use is billed to that account.
          </p>
          {status.canSave ? (
            <>
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  value={keyDraft}
                  placeholder="sk-ant-…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setKeyDraft(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn--export"
                disabled={keyDraft.trim().length < 20}
                onClick={() => {
                  void api.aiSetKey(keyDraft)
                    .then((s) => { setStatus(s); setKeyDraft('') })
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                }}
              >
                Save key
              </button>
              <p className="assistant__hint">Kept encrypted on this computer. It is only ever sent to Anthropic.</p>
            </>
          ) : (
            <p className="assistant__hint">
              This system has no secure storage for a key. Set the ANTHROPIC_API_KEY environment variable and restart Tiovivo.
            </p>
          )}
          {error && <p className="assistant__error">{error}</p>}
        </div>
      ) : (
        <div className="assistant__body">
          <div className="assistant__tasks" role="tablist" aria-label="What to do">
            {TASKS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={task === t.id}
                className={`btn btn--sm ${task === t.id ? 'btn--seg-active' : ''}`}
                disabled={busy}
                onClick={() => { setTask(t.id); setError(null) }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="assistant__note">{current.blurb}</p>

          {task === 'create' && (
            <>
              <label className="field">
                <span>Brief</span>
                <textarea
                  value={brief}
                  rows={7}
                  placeholder="What is the post about, and who is it for? You can paste an article, a script, a transcript or a link."
                  onChange={(e) => setBrief(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="field">
                <span>Format</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as Preset)} disabled={busy}>
                  {formats.map((p) => <option key={p} value={p}>{FORMAT_NAMES[p]} · {PRESETS[p].width}×{PRESETS[p].height}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Slides</span>
                <select
                  value={String(count)}
                  onChange={(e) => setCount(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                  disabled={busy}
                >
                  <option value="auto">As many as it needs</option>
                  {[1, 3, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <p className="assistant__hint">Starts a new document. You are asked first if the open one has unsaved changes.</p>
            </>
          )}

          {task === 'reformat' && (
            <>
              <label className="field">
                <span>New format</span>
                <select value={target} onChange={(e) => setTarget(e.target.value as Preset)} disabled={busy}>
                  {formats.filter((p) => p !== presetId).map((p) => (
                    <option key={p} value={p}>{FORMAT_NAMES[p]} · {PRESETS[p].width}×{PRESETS[p].height}</option>
                  ))}
                </select>
              </label>
              <label className="check" title="Staggered text entrances and a reading time per slide, for Export → One video.">
                <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} disabled={busy} />
                Animate it for video
              </label>
              <p className="assistant__hint">
                Works on an untitled copy, so the file you saved keeps its layout. Every step can be undone.
              </p>
            </>
          )}

          {busy ? (
            <div className="assistant__run">
              <ul className="assistant__log" aria-live="polite">
                {lines.length === 0 && <li>Thinking…</li>}
                {lines.slice(-6).map((l, i, arr) => (
                  <li key={`${i}-${l}`} className={i === arr.length - 1 ? 'assistant__log-now' : undefined}>{l}</li>
                ))}
              </ul>
              <button type="button" className="btn btn--sm" onClick={stop}>Stop</button>
            </div>
          ) : (
            <button type="button" className="btn btn--export assistant__go" onClick={() => { void go() }}>
              {task === 'create' ? 'Create carousel'
                : task === 'review' ? (review ? 'Review again' : 'Review this deck')
                : task === 'hooks' ? (hooks ? 'Write ten more' : 'Write ten hooks')
                : task === 'captions' ? (captions ? 'Write again' : 'Write captions')
                : `Repurpose to ${FORMAT_NAMES[target]}`}
            </button>
          )}

          {error && <p className="assistant__error">{error}</p>}

          {!busy && (task === 'create' || task === 'reformat') && summary[task] && (
            <p className="assistant__summary">{summary[task]}</p>
          )}

          {!busy && task === 'review' && review && (
            <div className="assistant__results">
              <p className="assistant__summary">{review.summary}</p>
              {fixable.length > 1 && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => { for (const { f, i } of fixable) fixOne(i, f) }}
                >
                  Fix all {fixable.length}
                </button>
              )}
              {review.findings.length === 0 && <p className="assistant__note">Nothing to fix.</p>}
              <ul className="assistant__findings">
                {review.findings.map((f, i) => (
                  <li key={i} className={`finding finding--${f.severity}${fixed.has(i) ? ' finding--done' : ''}`}>
                    <button type="button" className="finding__where" onClick={() => goToSlide(f.slide)} title="Show this slide">
                      Slide {f.slide}
                    </button>
                    <b>{f.title}</b>
                    <p>{f.detail}</p>
                    {f.fix.length > 0 && (
                      fixed.has(i)
                        ? <span className="finding__done">Fixed</span>
                        : <button type="button" className="btn btn--sm" onClick={() => fixOne(i, f)}>Fix</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!busy && task === 'hooks' && hooks && (
            <ul className="assistant__hooks">
              {hooks.hooks.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`hook${usedHook === i ? ' hook--on' : ''}`}
                    onClick={() => applyHook(i, h.headline)}
                    title="Put this on slide 1"
                  >
                    <b>{h.headline}</b>
                    <span>{h.angle}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!busy && task === 'captions' && captions && (
            <div className="assistant__results">
              {([
                ['Instagram caption', `${captions.instagram.caption}\n\n${tags(captions.instagram.hashtags)}`],
                ['First comment', captions.instagram.firstComment],
                ['TikTok caption', `${captions.tiktok.caption} ${tags(captions.tiktok.hashtags)}`],
                ['Alt text', captions.altText.map((a) => `Slide ${a.slide}: ${a.text}`).join('\n')],
              ] as const).map(([label, body]) => (
                <section key={label} className="caption">
                  <header>
                    <h3>{label}</h3>
                    <button type="button" className="btn btn--sm" onClick={() => { void copy(body, label) }}>Copy</button>
                  </header>
                  <p>{body}</p>
                </section>
              ))}
            </div>
          )}

          <footer className="assistant__foot">
            <span>Claude Opus 5.5 · {status.source === 'saved' ? 'your saved key' : 'key from the environment'}</span>
            {status.source === 'saved' && (
              <button type="button" className="mcp__link" onClick={() => { void api.aiClearKey().then(setStatus) }}>
                Remove key
              </button>
            )}
          </footer>
        </div>
      )}
    </aside>
  )
}
