/* The in-app assistant: Claude working on the open document.
 *
 * Runs in the main process so the API key never reaches the renderer. Tasks
 * that edit the deck are an agent loop over the same tools the MCP server
 * exposes (mcpTools.ts); tasks that only produce something to read — a
 * review, hooks, captions, a brand — are one request with a JSON schema.
 */
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { app, ipcMain, dialog, clipboard, nativeImage, safeStorage, BrowserWindow } from 'electron'
import { TOOLS } from './mcpTools'

const MODEL = 'claude-opus-5-5'
const MAX_TURNS = 60
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export interface AiHost {
  getWindow: () => BrowserWindow | null
  /** Run one document tool (the MCP server's implementation). */
  runTool: (name: string, args: unknown) => Promise<{
    json?: unknown
    text?: string
    image?: { data: string; mimeType: string }
  }>
}

export interface AiStatus {
  /** Where credentials come from: a key saved in the app, the environment
   *  (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN), or nowhere yet. */
  source: 'saved' | 'environment' | null
  /** False when the OS offers no secure storage to keep a key in. */
  canSave: boolean
}

type Content = Anthropic.Beta.BetaContentBlockParam[]

class AiError extends Error {}

/* ---- prompts ---- */

const DESIGNER = `You are the designer inside Tiovivo, a desktop editor for Instagram and TikTok carousels and short videos. You work directly on the document that is open in the app, with tools; the person watches the canvas change.

How to design here:
- Coordinates are slide pixels from the top-left. Text takes x, y and width; its height is measured by the app and returned to you, so read it back before placing something underneath.
- One idea per slide. A headline someone can read in two seconds, then at most a few short lines. Cut words before shrinking type.
- Hierarchy through size and weight: headlines large (roughly 90–150px on a 1080-wide slide), body 38–48px, never below 30px.
- Keep at least 80px from every edge. On 9:16 keep the top 250px and bottom 420px free of anything important: the apps draw their interface there.
- Slide 1 is the hook: it must make sense alone and give a reason to swipe. The last slide asks for one action.
- Use the person's brand kit from get_project (fonts, ground, text and accent colours, handle, voice) unless they ask otherwise. Check contrast: text must clearly read on its ground.
- Vary the slides, but keep one grid: the same margins and the same position for recurring elements.

Always look at your work: call render on slides you made or changed, and fix what is off (overflow, collisions, weak contrast, orphaned words) before you finish. When you are done, reply with two or three plain sentences on what you made. No markdown.`

/* ---- JSON schemas for the read-only tasks ---- */

const str = { type: 'string' }
const nullable = (type: string) => ({ type: [type, 'null'] })
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})

const REVIEW_SCHEMA = obj({
  summary: { type: 'string', description: 'Two sentences: what works, and the main thing to fix.' },
  findings: {
    type: 'array',
    items: obj({
      slide: { type: 'integer', description: '1-based slide number.' },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      title: { type: 'string', description: 'The problem in under eight words.' },
      detail: { type: 'string', description: 'One or two sentences: why it hurts and what to do.' },
      fix: {
        description: 'Item changes that resolve it, or an empty list when it needs a human decision. Give only the fields that change; null for the rest.',
        type: 'array',
        items: obj({
          id: { type: 'string', description: 'Item id from the project.' },
          text: nullable('string'),
          x: nullable('number'),
          y: nullable('number'),
          width: nullable('number'),
          fontSize: nullable('number'),
          textColor: nullable('string'),
          lineHeight: nullable('number'),
        }),
      },
    }),
  },
})

const HOOKS_SCHEMA = obj({
  hooks: {
    type: 'array',
    items: obj({
      headline: { type: 'string', description: 'The slide-1 headline. Use \\n for a deliberate line break.' },
      angle: { type: 'string', description: 'The idea behind it in a few words, e.g. "contrarian", "specific number".' },
    }),
  },
})

const CAPTIONS_SCHEMA = obj({
  instagram: obj({
    caption: str,
    hashtags: { type: 'array', items: str },
    firstComment: { type: 'string', description: 'A first comment from the author that invites replies.' },
  }),
  tiktok: obj({
    caption: { type: 'string', description: 'Short; TikTok captions are skimmed.' },
    hashtags: { type: 'array', items: str },
  }),
  altText: {
    type: 'array',
    items: obj({ slide: { type: 'integer' }, text: { type: 'string', description: 'What the slide shows and says, for screen readers.' } }),
  },
})

const BRAND_SCHEMA = obj({
  background: { type: 'string', description: 'Dominant slide ground as #rrggbb.' },
  text: { type: 'string', description: 'Main text colour on that ground as #rrggbb.' },
  accent: { type: 'string', description: 'The one loud colour as #rrggbb.' },
  headingFont: { type: 'string', description: 'A family from the installed list closest to the headline type.' },
  bodyFont: { type: 'string', description: 'A family from the installed list closest to the body type.' },
  voice: { type: 'string', description: 'How this brand writes, in two or three sentences someone could follow.' },
  notes: { type: 'string', description: 'One or two sentences on what you saw and any guess you made.' },
})

/* ---- helpers ---- */

function toolLabel(name: string, input: Record<string, unknown>): string {
  const slide = input.slide ?? input.after
  const on = slide !== undefined ? ` on slide ${String(slide)}` : ''
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)
  switch (name) {
    case 'get_project': return 'Reading the deck'
    case 'set_format': return 'Changing the format'
    case 'add_slide': return `Adding a slide${typeof input.name === 'string' ? `: ${input.name}` : ''}`
    case 'update_slide': return `Updating slide ${String(input.slide ?? '')}`.trim()
    case 'duplicate_slide': return `Duplicating slide ${String(input.slide ?? '')}`.trim()
    case 'remove_slide': return `Removing slide ${String(input.slide ?? '')}`.trim()
    case 'add_items': return `Adding ${count(input.items)} item${count(input.items) === 1 ? '' : 's'}${on}`
    case 'update_items': return `Adjusting ${count(input.updates)} item${count(input.updates) === 1 ? '' : 's'}`
    case 'remove_items': return `Removing ${count(input.ids)} item${count(input.ids) === 1 ? '' : 's'}`
    case 'reorder_layers': return `Reordering layers${on}`
    case 'render': return slide !== undefined ? `Looking at slide ${String(slide)}` : 'Looking at the whole deck'
    case 'list_fonts': return 'Checking installed fonts'
    case 'undo': return 'Undoing a step'
    default: return name
  }
}

const keyPath = () => path.join(app.getPath('userData'), 'ai-key.bin')

export function initAi(host: AiHost) {
  /* ---- credentials ---- */
  const readSavedKey = (): string | null => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null
      return safeStorage.decryptString(fs.readFileSync(keyPath())) || null
    } catch {
      return null // no key saved, or it was encrypted for another OS user
    }
  }
  const status = (): AiStatus => ({
    source: readSavedKey()
      ? 'saved'
      : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'environment' : null,
    canSave: safeStorage.isEncryptionAvailable(),
  })
  const client = (): Anthropic => {
    const saved = readSavedKey()
    if (saved) return new Anthropic({ apiKey: saved })
    if (status().source === 'environment') return new Anthropic()
    throw new AiError('Add your Anthropic API key first.')
  }

  /* ---- one model request ---- */
  // Cleared the first time the API turns the fallback parameter down, so a
  // long agent run does not pay for a rejected request on every turn.
  let useFallback = true
  async function ask(
    body: Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'model' | 'max_tokens'>,
    signal: AbortSignal,
  ): Promise<Anthropic.Beta.BetaMessage> {
    const anthropic = client()
    const base: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 16000,
      ...body,
      // Thinking is always on for this model; effort is its one dial, and
      // the default (medium) is set explicitly so it never changes silently.
      output_config: { effort: 'medium', ...body.output_config },
    }
    let res: Anthropic.Beta.BetaMessage
    if (!useFallback) {
      res = await anthropic.beta.messages.create(base, { signal })
    } else try {
      // Server-side fallback: if a safety classifier declines the request,
      // the API re-runs it on its default fallback model in the same call.
      res = await anthropic.beta.messages.create(
        { ...base, betas: [FALLBACK_BETA], fallbacks: 'default' },
        { signal },
      )
    } catch (err) {
      // An account or deployment that can't take the fallback parameter
      // answers 400; the request itself is still good without it.
      if (!(err instanceof Anthropic.BadRequestError)) throw err
      res = await anthropic.beta.messages.create(base, { signal })
      useFallback = false
    }
    if (res.stop_reason === 'refusal') throw new AiError('Claude declined this request.')
    if (res.stop_reason === 'max_tokens') throw new AiError('The answer ran too long. Try a smaller deck or a shorter brief.')
    return res
  }

  const textOf = (msg: Anthropic.Beta.BetaMessage) =>
    msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()

  async function askJson<T>(system: string, content: Content, schema: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    const res = await ask({
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema } },
    }, signal)
    try {
      return JSON.parse(textOf(res)) as T
    } catch {
      throw new AiError('Claude returned something unreadable. Try again.')
    }
  }

  /* ---- agent loop over the document tools ---- */
  const AGENT_TOOLS = new Set([
    'get_project', 'set_format', 'add_slide', 'update_slide', 'duplicate_slide', 'remove_slide',
    'add_items', 'update_items', 'remove_items', 'reorder_layers', 'render', 'list_fonts', 'undo',
  ])
  const documentTools: Anthropic.Beta.BetaToolUnion[] = TOOLS.filter((t) => AGENT_TOOLS.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
  }))

  async function agent(opts: {
    task: string
    content: Content
    webFetch?: boolean
    signal: AbortSignal
    progress: (line: string) => void
  }): Promise<string> {
    const tools: Anthropic.Beta.BetaToolUnion[] = [...documentTools]
    // Lets a link in the brief be read. It can only fetch URLs that already
    // appear in the conversation.
    if (opts.webFetch) tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 })
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.content }]
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await ask({
        system: [{ type: 'text', text: `${DESIGNER}\n\n${opts.task}`, cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
        // The conversation only grows, so everything before the newest turn
        // is read from cache.
        cache_control: { type: 'ephemeral' },
      }, opts.signal)
      messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] })
      if (res.stop_reason === 'pause_turn') continue
      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      if (calls.length === 0) return textOf(res)
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
      for (const call of calls) {
        opts.signal.throwIfAborted()
        const input = (call.input ?? {}) as Record<string, unknown>
        opts.progress(toolLabel(call.name, input))
        try {
          if (!AGENT_TOOLS.has(call.name)) throw new Error(`Unknown tool: ${call.name}`)
          const r = await host.runTool(call.name, input)
          const content: Anthropic.Beta.BetaToolResultBlockParam['content'] = []
          if (r.json !== undefined) content.push({ type: 'text', text: JSON.stringify(r.json) })
          if (r.text) content.push({ type: 'text', text: r.text })
          if (r.image) {
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: r.image.mimeType as 'image/jpeg', data: r.image.data },
            })
          }
          if (content.length === 0) content.push({ type: 'text', text: 'Done.' })
          results.push({ type: 'tool_result', tool_use_id: call.id, content })
        } catch (err) {
          results.push({
            type: 'tool_result', tool_use_id: call.id, is_error: true,
            content: err instanceof Error ? err.message : String(err),
          })
        }
      }
      messages.push({ role: 'user', content: results })
    }
    throw new AiError('Stopped after too many steps. What was built so far is on the canvas; undo takes it back.')
  }

  /* ---- what the read-only tasks look at ---- */
  async function projectJson(): Promise<{ json: string; slides: number }> {
    const r = await host.runTool('get_project', {})
    const project = r.json as { slides?: unknown[] }
    return { json: JSON.stringify(project), slides: project.slides?.length ?? 0 }
  }

  async function slideImages(count: number, progress: (line: string) => void): Promise<Content> {
    const out: Content = []
    const MAX = 12
    for (let n = 1; n <= Math.min(count, MAX); n++) {
      progress(`Looking at slide ${n}`)
      const r = await host.runTool('render', { slide: n, max_size: 800 })
      if (!r.image) continue
      out.push({ type: 'text', text: `Slide ${n}:` })
      out.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.image.data } })
    }
    if (count > MAX) out.push({ type: 'text', text: `(Slides ${MAX + 1}–${count} are not shown.)` })
    return out
  }

  /* ---- images the user picked for brand learning ---- */
  const pickedImages = new Set<string>()
  ipcMain.handle('ai-pick-images', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a few of your past posts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    }
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled) return []
    const paths = result.filePaths.slice(0, 8)
    for (const p of paths) pickedImages.add(path.resolve(p))
    return paths
  })

  function postImages(paths: unknown): Content {
    if (!Array.isArray(paths) || paths.length === 0) throw new AiError('Choose at least one image.')
    const out: Content = []
    for (const p of paths.slice(0, 8)) {
      // Only files the person chose in the picker above.
      if (typeof p !== 'string' || !pickedImages.has(path.resolve(p))) continue
      const img = nativeImage.createFromPath(p)
      if (img.isEmpty()) continue
      const { width, height } = img.getSize()
      const scale = Math.min(1, 1024 / Math.max(width, height))
      const jpeg = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale) }).toJPEG(85)
      out.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } })
    }
    if (out.length === 0) throw new AiError('None of those images could be read.')
    return out
  }

  /* ---- tasks ---- */
  type Params = Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

  async function runTask(task: string, params: Params, signal: AbortSignal, progress: (line: string) => void): Promise<unknown> {
    switch (task) {
      case 'create': {
        const brief = text(params.brief, 60_000).trim()
        if (!brief) throw new AiError('Describe what the post is about.')
        const count = typeof params.slides === 'number' ? `exactly ${Math.round(params.slides)} slides` : 'as many slides as the content needs (usually 5 to 8)'
        const summary = await agent({
          task: `Task: build a carousel from the person's brief. The document is new: it has one blank slide in the format they chose, so restyle slide 1 with update_slide and add_items, then add the rest with add_slide. Make ${count}. If the brief is long (an article, script or transcript), distil it; do not paste it. If it contains a link, read it with web_fetch first.`,
          content: [{ type: 'text', text: `Brief:\n\n${brief}` }],
          webFetch: true,
          signal,
          progress,
        })
        return { summary }
      }

      case 'reformat': {
        const preset = text(params.preset, 10)
        const animate = params.animate === true
        const summary = await agent({
          task: `Task: repurpose the open deck for another format. Call get_project, then set_format to preset "${preset}". Changing the format keeps every item's size and only shifts positions, so re-lay out each slide for the new shape: resize and reposition text, shapes and images so the composition works and nothing is clipped or left stranded. Keep the copy and the look. Render every slide to check it.${animate ? ' This version is for video: give the text on each slide entrance animations (animIn fade or rise) staggered in reading order with animDelay about 0.4s apart, starting with the headline at 0, and set each slide\'s seconds so it can be read comfortably.' : ''}`,
          content: [{ type: 'text', text: `Repurpose this deck to ${preset}.` }],
          signal,
          progress,
        })
        return { summary }
      }

      case 'review': {
        progress('Reading the deck')
        const project = await projectJson()
        const images = await slideImages(project.slides, progress)
        progress('Reviewing')
        return askJson(
          `You review social carousels the way a sharp art director and editor would, before they are posted. You are given the deck's data and a render of each slide. Judge what is on the slides, not what you imagine: weak or generic hook on slide 1, too much text, unclear hierarchy, low contrast, text too small to read on a phone, elements too close to the edge or under the app's interface (on 9:16: top 250px, bottom 420px, right 140px), collisions and overflow, inconsistent margins between slides, typos and awkward wording, a missing call to action. Report real problems only, most important first, at most ten. If the deck is good, say so and return few findings. When a problem can be solved by changing item fields, give the fix using item ids from the data; coordinates are slide pixels.`,
          [{ type: 'text', text: `Deck data:\n${project.json}` }, ...images],
          REVIEW_SCHEMA,
          signal,
        )
      }

      case 'hooks': {
        progress('Reading the deck')
        const project = await projectJson()
        const r = await host.runTool('render', { max_size: 1400 })
        progress('Writing hooks')
        const content: Content = [{ type: 'text', text: `Deck data:\n${project.json}` }]
        if (r.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.image.data } })
        return askJson(
          `You write first-slide hooks for social carousels. Given a deck, write ten alternative headlines for slide 1. Each must be true to what the deck actually delivers, make sense with no context, and give a reason to swipe. Make them genuinely different from one another in angle (a specific number, a contrarian claim, a question, a mistake to avoid, a result, a story opening, and so on), about as long as the current headline, and in the brand's voice if the data gives one. No clickbait the deck cannot pay off, no emoji, no hashtags.`,
          content,
          HOOKS_SCHEMA,
          signal,
        )
      }

      case 'captions': {
        progress('Reading the deck')
        const project = await projectJson()
        const images = await slideImages(project.slides, progress)
        progress('Writing captions')
        return askJson(
          `You write the text that goes around a social post. Given a deck, write: an Instagram caption (a first line that works as a hook when truncated, then two to four short paragraphs, then one clear call to action), five to eight relevant Instagram hashtags, a first comment from the author; a short TikTok caption with three to five hashtags; and alt text for each slide. Write in the brand's voice if the data gives one, otherwise plainly and warmly. Do not invent facts the deck does not state. Hashtags without the # sign.`,
          [{ type: 'text', text: `Deck data:\n${project.json}` }, ...images],
          CAPTIONS_SCHEMA,
          signal,
        )
      }

      case 'brand': {
        const fonts = Array.isArray(params.fonts)
          ? params.fonts.filter((f): f is string => typeof f === 'string').slice(0, 700)
          : []
        const images = postImages(params.paths)
        progress(`Studying ${images.length} post${images.length === 1 ? '' : 's'}`)
        return askJson(
          `You extract a brand kit from someone's past social posts. Look at the images and report: the dominant slide ground, the main text colour on it, and the one accent colour, each as #rrggbb sampled from what you see; a heading font and a body font chosen from the installed families listed (the closest match in character, since you can only choose from that list); and the brand's writing voice, read from the copy in the posts. If the posts disagree with each other, go with the majority and say so in notes.`,
          [...images, { type: 'text', text: `Installed font families:\n${fonts.join(', ')}` }],
          BRAND_SCHEMA,
          signal,
        )
      }

      default:
        throw new AiError(`Unknown task: ${task}`)
    }
  }

  /* ---- IPC ---- */
  const running = new Map<string, AbortController>()

  ipcMain.handle('ai-status', async () => status())
  ipcMain.handle('ai-set-key', async (_e, key: unknown) => {
    if (typeof key !== 'string' || key.trim().length < 20) throw new Error('That does not look like an API key.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage to keep the key in.')
    await fs.promises.writeFile(keyPath(), safeStorage.encryptString(key.trim()))
    return status()
  })
  ipcMain.handle('ai-clear-key', async () => {
    await fs.promises.rm(keyPath(), { force: true })
    return status()
  })
  ipcMain.handle('copy-text', async (_e, value: unknown) => {
    if (typeof value !== 'string' || value.length > 50_000) return false
    clipboard.writeText(value)
    return true
  })
  ipcMain.handle('ai-cancel', async (_e, runId: string) => {
    running.get(runId)?.abort()
  })
  ipcMain.handle('ai-run', async (event, req: { runId: string; task: string; params?: Params }) => {
    const controller = new AbortController()
    running.set(req.runId, controller)
    const progress = (line: string) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:progress', { runId: req.runId, line })
    }
    try {
      const result = await runTask(req.task, req.params ?? {}, controller.signal, progress)
      return { ok: true, result }
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, cancelled: true, error: 'Stopped.' }
      // Most-specific first: these are the failures a person can act on.
      let error: string
      if (err instanceof AiError) error = err.message
      else if (err instanceof Anthropic.AuthenticationError) error = 'The API key was rejected. Check it in the Assistant settings.'
      else if (err instanceof Anthropic.PermissionDeniedError) error = 'This API key is not allowed to use that model.'
      else if (err instanceof Anthropic.RateLimitError) error = 'Rate limited by the API. Wait a moment and try again.'
      else if (err instanceof Anthropic.APIConnectionError) error = 'Could not reach the Anthropic API. Check your connection.'
      else if (err instanceof Anthropic.APIError) error = `The API returned an error (${err.status ?? 'unknown'}): ${err.message}`
      else error = err instanceof Error ? err.message : String(err)
      return { ok: false, error }
    } finally {
      running.delete(req.runId)
    }
  })
}
