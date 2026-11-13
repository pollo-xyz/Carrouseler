/* Renderer half of the built-in MCP server (electron/mcp.ts): runs a tool
 * call from a connected agent against the live document. Everything goes
 * through the same store actions the UI uses, so each change is undoable
 * and shows up on the canvas as it happens. */
import { useTiovivoStore } from '../store/useTiovivoStore'
import type { PlacedMedia, ShapeKind, Slide } from '../store/useTiovivoStore'
import { PRESETS } from './presets'
import type { PresetId } from './presets'
import { NAMED_PALETTES, defaultBgVibe, randomSeed } from './bgVibe'
import type { BgVibe } from './bgVibe'
import { generateProjectPreview } from './thumbnail'
import { resolveWorkspaceBg, useThemeStore } from './theme'
import { useBrandStore } from './brand'

export interface McpToolResult {
  json?: unknown
  text?: string
  image?: { data: string; mimeType: string }
}

/** What the bridge needs from the app shell (App.tsx owns these flows). */
export interface McpContext {
  renderSlidePng: (slideId: string) => Promise<Blob | null>
  isBusy: () => boolean
  projectPath: () => string | null
  /** Save to `path`, or in place when null. False = nothing was written. */
  saveTo: (path: string | null) => Promise<boolean>
  exportTo: (dir: string, prefix: string) => Promise<{ written: string[]; videoErrors: number }>
  newProject: () => void
  listFonts: () => Promise<string[]>
}

type Args = Record<string, unknown>
type FieldKind = 'n' | 's' | 'b'

const COMMON: Record<string, FieldKind> = {
  x: 'n', y: 'n', width: 'n', height: 'n', rotation: 'n', name: 's', appearsOnAllSlides: 'b',
}
const TEXT: Record<string, FieldKind> = {
  text: 's', fontFamily: 's', fontSize: 'n', bold: 'b', italic: 'b', textColor: 's', textAlign: 's',
  lineHeight: 'n', letterSpacing: 'n', fillMode: 'b',
  shadowEnabled: 'b', shadowColor: 's', shadowBlur: 'n', shadowOffsetX: 'n', shadowOffsetY: 'n', shadowOpacity: 'n',
  textBgColor: 's', textBgPadding: 'n', textBgCornerRadius: 'n', textBgOpacity: 'n',
}
const SHAPE: Record<string, FieldKind> = {
  shapeKind: 's', fillColor: 's', strokeColor: 's', strokeWidth: 'n', cornerRadius: 'n',
}
const MEDIA: Record<string, FieldKind> = {
  opacity: 'n', brightness: 'n', contrast: 'n', saturation: 'n', blur: 'n', flipX: 'b', flipY: 'b',
}
const ENUMS: Record<string, string[]> = {
  textAlign: ['left', 'center', 'right', 'justify'],
  shapeKind: ['rect', 'ellipse', 'line'],
}
/** Keys of a new-item spec that aren't item fields. */
const SPEC_ONLY = new Set(['type', 'path', 'fit', 'data', 'mime', 'fileName'])

function fieldsFor(type: PlacedMedia['type']): Record<string, FieldKind> {
  if (type === 'text') return { ...COMMON, ...TEXT }
  if (type === 'shape') return { ...COMMON, ...SHAPE }
  return { ...COMMON, ...MEDIA }
}

/** Validate an agent-supplied field bag into a store patch. Unknown or
 *  mistyped fields are errors, not silently dropped — the model can only
 *  correct what it's told about. */
function toPatch(spec: Args, type: PlacedMedia['type'], skip: Set<string>): Partial<PlacedMedia> {
  const allowed = fieldsFor(type)
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(spec)) {
    if (skip.has(key) || value === undefined) continue
    const kind = allowed[key]
    if (!kind) {
      throw new Error(`"${key}" is not a field of ${type} items. Fields: ${Object.keys(allowed).join(', ')}.`)
    }
    const ok =
      kind === 'n' ? typeof value === 'number' && Number.isFinite(value)
      : kind === 's' ? typeof value === 'string'
      : typeof value === 'boolean'
    if (!ok) throw new Error(`"${key}" must be a ${kind === 'n' ? 'number' : kind === 's' ? 'string' : 'boolean'}.`)
    if (ENUMS[key] && !ENUMS[key]!.includes(value as string)) {
      throw new Error(`"${key}" must be one of ${ENUMS[key]!.join(', ')}.`)
    }
    patch[key] = value
  }
  if (typeof patch.width === 'number' && patch.width <= 0) throw new Error('"width" must be positive.')
  if (typeof patch.height === 'number' && patch.height <= 0) throw new Error('"height" must be positive.')
  return patch as Partial<PlacedMedia>
}

const store = () => useTiovivoStore.getState()

function resolveSlide(ref: unknown): Slide {
  const st = store()
  if (ref === undefined || ref === null) {
    return st.slides.find((s) => s.id === st.activeSlideId) ?? st.slides[0]!
  }
  if (typeof ref === 'number') {
    const slide = st.slides[ref - 1]
    if (!slide) throw new Error(`There is no slide ${ref} — the deck has ${st.slides.length}.`)
    return slide
  }
  const byId = st.slides.find((s) => s.id === ref)
  if (byId) return byId
  // Tolerate "3" arriving as a string.
  const n = Number(ref)
  if (Number.isInteger(n) && st.slides[n - 1]) return st.slides[n - 1]!
  throw new Error(`No slide matches "${String(ref)}".`)
}

const round = (n: number) => Math.round(n * 10) / 10

function describeItem(it: PlacedMedia) {
  const st = store()
  const out: Record<string, unknown> = {
    id: it.id,
    type: it.type,
    slide: st.slides.findIndex((s) => s.id === it.slideId) + 1,
    name: it.name,
    x: round(it.x), y: round(it.y), width: round(it.width), height: round(it.height),
  }
  if (it.rotation) out.rotation = round(it.rotation)
  if (it.appearsOnAllSlides) out.appearsOnAllSlides = true
  if (it.type === 'text') {
    Object.assign(out, {
      text: it.text, fontFamily: it.fontFamily, fontSize: it.fontSize, textColor: it.textColor,
      textAlign: it.textAlign, lineHeight: it.lineHeight,
    })
    if (it.bold) out.bold = true
    if (it.italic) out.italic = true
    if (it.letterSpacing) out.letterSpacing = it.letterSpacing
    if (it.fillMode) out.fillMode = true
    if (it.textBgColor) out.textBgColor = it.textBgColor
  } else if (it.type === 'shape') {
    Object.assign(out, { shapeKind: it.shapeKind, fillColor: it.fillColor })
    if (it.strokeWidth) Object.assign(out, { strokeColor: it.strokeColor, strokeWidth: it.strokeWidth })
    if (it.cornerRadius) out.cornerRadius = it.cornerRadius
  } else {
    Object.assign(out, { naturalWidth: it.naturalWidth, naturalHeight: it.naturalHeight })
    if (it.opacity !== undefined && it.opacity !== 1) out.opacity = it.opacity
  }
  return out
}

function describeSlide(slide: Slide) {
  const st = store()
  return {
    slide: st.slides.findIndex((s) => s.id === slide.id) + 1,
    id: slide.id,
    ...(slide.name?.trim() ? { name: slide.name.trim() } : {}),
    background: slide.bgVibe ? { vibe: slide.bgVibe.palette } : slide.bgColor,
    ...(slide.exportEnabled ? {} : { exportEnabled: false }),
    items: st.items.filter((i) => i.slideId === slide.id).map(describeItem),
  }
}

/** Let React commit and the canvas measure text. Timer-backed: a minimised
 *  window never fires requestAnimationFrame. */
function settle(ms = 140): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    setTimeout(finish, ms + 200)
    if (typeof requestAnimationFrame !== 'function') return
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(finish)), ms)
  })
}

function buildVibe(spec: unknown, current?: BgVibe): BgVibe {
  const v = (spec ?? {}) as Args
  const base = current ?? defaultBgVibe()
  let palette = base.palette
  if (typeof v.palette === 'string') {
    const named = NAMED_PALETTES.find((p) => p.name.toLowerCase() === (v.palette as string).toLowerCase())
    if (!named) throw new Error(`Unknown palette "${v.palette}". Named palettes: ${NAMED_PALETTES.map((p) => p.name).join(', ')}.`)
    palette = [...named.colors]
  } else if (Array.isArray(v.palette)) {
    const colors = v.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
    if (colors.length < 2 || colors.length !== v.palette.length) {
      throw new Error('A vibe palette is 2–8 colours written as #rrggbb.')
    }
    palette = colors.slice(0, 8)
  }
  const num = (key: string, lo: number, hi: number, fallback: number) =>
    typeof v[key] === 'number' ? Math.min(hi, Math.max(lo, v[key] as number)) : fallback
  return {
    ...base,
    palette,
    pointCount: Math.round(num('pointCount', 3, 8, Math.min(8, Math.max(3, current?.pointCount ?? palette.length)))),
    blur: num('blur', 0, 200, base.blur),
    grain: num('grain', 0, 1, base.grain),
    size: num('size', 0.2, 4, base.size ?? 1),
    seed: typeof v.seed === 'number' ? Math.round(v.seed) : current?.seed ?? randomSeed(),
  }
}

function applySlideBackground(slideId: string, args: Args) {
  const st = store()
  if (typeof args.bgColor === 'string') {
    st.setSlideBgColor(slideId, args.bgColor)
    // A vibe outranks the solid colour, so asking for a colour means dropping it.
    if (args.vibe === undefined && st.slides.find((s) => s.id === slideId)?.bgVibe) {
      st.setSlideBgVibe(slideId, null)
    }
  }
  if (args.vibe === null) st.setSlideBgVibe(slideId, null)
  else if (args.vibe !== undefined) {
    st.setSlideBgVibe(slideId, buildVibe(args.vibe, store().slides.find((s) => s.id === slideId)?.bgVibe))
  }
}

async function measureMedia(file: File): Promise<{ w: number; h: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.src = url
      const ok = await new Promise<boolean>((res) => {
        v.onloadedmetadata = () => res(true)
        v.onerror = () => res(false)
      })
      const size = { w: v.videoWidth, h: v.videoHeight }
      v.removeAttribute('src')
      v.load()
      return ok && size.w && size.h ? size : null
    }
    const img = new Image()
    img.src = url
    const ok = await new Promise<boolean>((res) => {
      img.onload = () => res(true)
      img.onerror = () => res(false)
    })
    return ok && img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Add items to a slide; returns the new ids plus notes worth telling the agent. */
async function addItems(slideId: string, specs: unknown): Promise<{ ids: string[]; notes: string[] }> {
  if (!Array.isArray(specs)) throw new Error('"items" must be an array.')
  // All or nothing: check every spec before the first item lands…
  for (const raw of specs as Args[]) {
    const type = raw?.type
    if (type !== 'text' && type !== 'shape' && type !== 'image') {
      throw new Error(`Item "type" must be text, shape or image (got ${JSON.stringify(type)}).`)
    }
    toPatch(raw, type, SPEC_ONLY)
    if (type === 'image' && raw.fit !== undefined && !['cover', 'contain', 'none'].includes(raw.fit as string)) {
      throw new Error('"fit" must be cover, contain or none.')
    }
  }
  const ids: string[] = []
  const notes: string[] = []
  try {
    await addValidated(slideId, specs as Args[], ids, notes)
  } catch (err) {
    // …and take back what was added if a file then fails to decode.
    if (ids.length) store().removeItems(ids)
    throw err
  }
  store().setSelectedIds([])
  return { ids, notes }
}

async function addValidated(slideId: string, specs: Args[], ids: string[], notes: string[]) {
  for (const raw of specs) {
    const type = raw.type
    // Each add targets the active slide — re-assert it per item, the user
    // may be clicking around while a long batch runs.
    store().setActiveSlide(slideId)
    if (type === 'text') {
      const patch = toPatch(raw, 'text', SPEC_ONLY)
      const family = patch.fontFamily
      if (family && !document.fonts.check(`16px "${family}"`)) {
        notes.push(`Font "${family}" isn't installed — the text falls back to a default face. See list_fonts.`)
      }
      ids.push(store().addText(patch))
    } else if (type === 'shape') {
      const patch = toPatch(raw, 'shape', SPEC_ONLY)
      ids.push(store().addShape((patch.shapeKind as ShapeKind | undefined) ?? 'rect', patch))
    } else if (type === 'image') {
      const patch = toPatch(raw, 'image', SPEC_ONLY)
      if (!(raw.data instanceof Uint8Array)) throw new Error('Image items need `path`.')
      const name = typeof raw.fileName === 'string' ? raw.fileName : 'image'
      const file = new File([raw.data as BlobPart], name, { type: String(raw.mime ?? '') })
      const size = await measureMedia(file)
      if (!size) throw new Error(`Couldn't decode "${name}" — unsupported format or damaged file.`)
      store().setActiveSlide(slideId)
      store().addMedia(file, size.w, size.h)
      const id = store().items[store().items.length - 1]!.id
      ids.push(id)
      const sized = patch.width !== undefined || patch.height !== undefined
      const fit = raw.fit ?? (sized ? 'none' : 'contain')
      if (fit === 'cover') store().fillItemToSlide(id)
      else if (fit === 'contain') store().fitItemToSlide(id)
      // One dimension given → keep the picture's proportions.
      if (patch.width !== undefined && patch.height === undefined) patch.height = (patch.width * size.h) / size.w
      else if (patch.height !== undefined && patch.width === undefined) patch.width = (patch.height * size.w) / size.h
      if (Object.keys(patch).length) store().updateItem(id, patch)
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Downscale a full-res slide PNG to a JPEG the model can look at cheaply. */
async function toViewImage(png: Blob, maxSize: number): Promise<{ data: string; mimeType: string }> {
  const bmp = await createImageBitmap(png)
  const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88))
  if (!jpeg) throw new Error('Could not encode the render.')
  return { data: await blobToBase64(jpeg), mimeType: 'image/jpeg' }
}

function applyFormat(args: Args): boolean {
  const st = store()
  if (typeof args.preset === 'string') {
    if (!(args.preset in PRESETS)) throw new Error(`Unknown preset "${args.preset}". Presets: ${Object.keys(PRESETS).join(', ')}.`)
    st.setPreset(args.preset as PresetId)
    return true
  }
  if (typeof args.width === 'number' && typeof args.height === 'number') {
    st.setCustomDimensions(args.width, args.height)
    return true
  }
  if (args.width !== undefined || args.height !== undefined) throw new Error('Custom sizes need both width and height.')
  return false
}

const formatOf = () => {
  const st = store()
  return { preset: st.presetId, width: st.dimensions.width, height: st.dimensions.height }
}

export async function runMcpTool(
  tool: string,
  args: Args,
  mutates: boolean,
  ctx: McpContext,
): Promise<McpToolResult> {
  if (ctx.isBusy() && (mutates || tool === 'export' || tool === 'save_project' || tool === 'render')) {
    throw new Error('Tiovivo is exporting right now. Try again when the export has finished.')
  }
  const st = store()

  switch (tool) {
    case 'get_project':
      return {
        json: {
          file: ctx.projectPath(),
          unsavedChanges: st.isDirty,
          format: formatOf(),
          activeSlide: st.slides.findIndex((s) => s.id === st.activeSlideId) + 1,
          slides: st.slides.map(describeSlide),
          vibePalettes: NAMED_PALETTES.map((p) => p.name),
          brand: useBrandStore.getState().brand,
        },
      }

    case 'new_project': {
      if (st.isDirty && args.discard_unsaved !== true) {
        throw new Error('The open document has unsaved changes. Call save_project first, or pass discard_unsaved: true to throw them away.')
      }
      ctx.newProject()
      applyFormat(args)
      // Setting the format is part of creating the document, not an edit to save.
      store().setDirty(false)
      return { json: { format: formatOf(), slides: store().slides.map(describeSlide) } }
    }

    case 'set_format': {
      if (!applyFormat(args)) throw new Error('Give a preset, or width and height.')
      return { json: { format: formatOf() } }
    }

    case 'add_slide': {
      const after = args.after === undefined ? st.slides.length - 1 : st.slides.findIndex((s) => s.id === resolveSlide(args.after).id)
      st.addSlide(after)
      const slideId = store().activeSlideId
      // addSlide copies the neighbour's background; a slide built by an
      // agent starts plain unless it says otherwise.
      if (args.vibe === undefined && store().slides.find((s) => s.id === slideId)?.bgVibe) {
        store().setSlideBgVibe(slideId, null)
      }
      if (typeof args.name === 'string') store().setSlideName(slideId, args.name)
      applySlideBackground(slideId, args)
      const { notes } = args.items ? await addItems(slideId, args.items) : { notes: [] }
      await settle()
      const slide = store().slides.find((s) => s.id === slideId)!
      return { json: { ...describeSlide(slide), ...(notes.length ? { notes } : {}) } }
    }

    case 'update_slide': {
      const slide = resolveSlide(args.slide)
      if (typeof args.name === 'string') st.setSlideName(slide.id, args.name)
      applySlideBackground(slide.id, args)
      if (typeof args.exportEnabled === 'boolean') store().setSlideExport(slide.id, args.exportEnabled)
      if (typeof args.position === 'number') {
        const target = store().slides[args.position - 1]
        if (!target) throw new Error(`Position ${args.position} is outside the deck (1–${store().slides.length}).`)
        store().reorderSlides(slide.id, target.id)
      }
      return { json: describeSlide(store().slides.find((s) => s.id === slide.id)!) }
    }

    case 'duplicate_slide': {
      st.duplicateSlide(resolveSlide(args.slide).id)
      return { json: describeSlide(store().slides.find((s) => s.id === store().activeSlideId)!) }
    }

    case 'remove_slide': {
      if (st.slides.length <= 1) throw new Error('A document keeps at least one slide.')
      st.removeSlide(resolveSlide(args.slide).id)
      return { json: { slides: store().slides.length } }
    }

    case 'add_items': {
      const slide = resolveSlide(args.slide)
      const { ids, notes } = await addItems(slide.id, args.items)
      await settle()
      const created = store().items.filter((i) => ids.includes(i.id)).map(describeItem)
      return { json: { items: created, ...(notes.length ? { notes } : {}) } }
    }

    case 'update_items': {
      if (!Array.isArray(args.updates)) throw new Error('"updates" must be an array.')
      const skip = new Set(['id', 'slide'])
      const patches = (args.updates as Args[]).map((u) => {
        const item = st.items.find((i) => i.id === u?.id)
        if (!item) throw new Error(`No item with id "${String(u?.id)}". Call get_project for current ids.`)
        const patch = toPatch(u, item.type, skip)
        if (u.slide !== undefined) patch.slideId = resolveSlide(u.slide).id
        return { id: item.id, patch }
      })
      st.updateItems(patches)
      await settle()
      const ids = patches.map((p) => p.id)
      return { json: { items: store().items.filter((i) => ids.includes(i.id)).map(describeItem) } }
    }

    case 'remove_items': {
      if (!Array.isArray(args.ids)) throw new Error('"ids" must be an array.')
      const known = (args.ids as unknown[]).filter((id): id is string => st.items.some((i) => i.id === id))
      st.removeItems(known)
      return { json: { removed: known.length } }
    }

    case 'reorder_layers': {
      const slide = resolveSlide(args.slide)
      const own = st.items.filter((i) => i.slideId === slide.id).map((i) => i.id)
      const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).map(String) : []
      if (ids.length !== own.length || new Set(ids).size !== ids.length || ids.some((id) => !own.includes(id))) {
        throw new Error(`"ids" must list each of the slide's ${own.length} item ids exactly once: ${own.join(', ')}.`)
      }
      st.reorderSlideLayers(slide.id, ids)
      return { json: describeSlide(store().slides.find((s) => s.id === slide.id)!) }
    }

    case 'render': {
      const maxSize = Math.min(2048, Math.max(256, typeof args.max_size === 'number' ? args.max_size : 1024))
      await settle(220) // images decode asynchronously after an add
      if (args.slide === undefined || args.slide === null) {
        const sheet = await generateProjectPreview(
          st.slides, st.items, st.dimensions,
          resolveWorkspaceBg(st.workspaceBgColor, useThemeStore.getState().theme),
        )
        if (!sheet) throw new Error('Nothing to render.')
        return { text: `Contact sheet of ${st.slides.length} slide(s), left to right.`, image: await toViewImage(sheet, maxSize) }
      }
      const slide = resolveSlide(args.slide)
      st.setSelectedIds([])
      const png = await ctx.renderSlidePng(slide.id)
      if (!png) throw new Error('The canvas is not ready to render yet.')
      const n = st.slides.findIndex((s) => s.id === slide.id) + 1
      return {
        text: `Slide ${n} at export fidelity (${st.dimensions.width}×${st.dimensions.height}, shown downscaled).`,
        image: await toViewImage(png, maxSize),
      }
    }

    case 'export': {
      const dir = String(args.dirPath)
      const { written, videoErrors } = await ctx.exportTo(dir, String(args.prefix ?? 'tiovivo'))
      if (written.length === 0) throw new Error('Nothing was exported — no slide is export-enabled, or every slide failed.')
      return {
        json: {
          folder: dir,
          files: written,
          ...(videoErrors ? { failedVideoSlides: videoErrors } : {}),
        },
      }
    }

    case 'save_project': {
      const target = typeof args.targetPath === 'string' ? args.targetPath : null
      if (!target && !ctx.projectPath()) {
        throw new Error('This document has never been saved — pass a `name` for it.')
      }
      if (!(await ctx.saveTo(target))) throw new Error('The project could not be saved.')
      return { json: { file: ctx.projectPath() } }
    }

    case 'list_fonts': {
      const all = await ctx.listFonts()
      const q = typeof args.filter === 'string' ? args.filter.toLowerCase() : ''
      const fonts = q ? all.filter((f) => f.toLowerCase().includes(q)) : all
      return { json: { count: fonts.length, fonts } }
    }

    case 'undo': {
      const steps = Math.min(50, Math.max(1, typeof args.steps === 'number' ? Math.round(args.steps) : 1))
      let done = 0
      while (done < steps && store()._past.length > 0) { store().undo(); done++ }
      return { json: { undone: done } }
    }

    default:
      throw new Error(`Unknown tool: ${tool}`)
  }
}
