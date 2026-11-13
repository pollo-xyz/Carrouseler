import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTiovivoStore } from '../store/useTiovivoStore'
import { runMcpTool, type McpContext } from './mcpBridge'

// Canvas work — not available (and not wanted) in node.
vi.mock('./thumbnail', () => ({
  generateThumbnail: vi.fn(async () => 'data:image/png;base64,mock'),
  generateProjectPreview: vi.fn(async () => null),
}))

const store = () => useTiovivoStore.getState()

function makeCtx(over: Partial<McpContext> = {}): McpContext {
  return {
    renderSlidePng: async () => null,
    isBusy: () => false,
    projectPath: () => null,
    saveTo: async () => true,
    exportTo: async () => ({ written: [], videoErrors: 0 }),
    newProject: () => store().resetProject(),
    listFonts: async () => ['Inter', 'Georgia'],
    ...over,
  }
}

const call = (tool: string, args: Record<string, unknown> = {}, ctx = makeCtx(), mutates = true) =>
  runMcpTool(tool, args, mutates, ctx)

beforeEach(() => {
  store().resetProject()
})

describe('mcp bridge', () => {
  it('add_slide builds a slide with its background and items in one call', async () => {
    const res = await call('add_slide', {
      name: 'Hook',
      bgColor: '#101010',
      items: [
        { type: 'text', text: 'Hello', x: 80, y: 100, width: 900, fontSize: 120, bold: true },
        { type: 'shape', shapeKind: 'ellipse', x: 10, y: 10, width: 50, height: 50, fillColor: '#ff0000' },
      ],
    })
    const s = store()
    expect(s.slides).toHaveLength(2)
    expect(s.slides[1]).toMatchObject({ name: 'Hook', bgColor: '#101010' })
    const items = s.items.filter((i) => i.slideId === s.slides[1]!.id)
    expect(items.map((i) => i.type)).toEqual(['text', 'shape'])
    expect(items[0]).toMatchObject({ text: 'Hello', x: 80, y: 100, width: 900, fontSize: 120, bold: true })
    expect(items[1]).toMatchObject({ shapeKind: 'ellipse', fillColor: '#ff0000' })
    expect(s.selectedIds).toEqual([])
    expect((res.json as { slide: number }).slide).toBe(2)
  })

  it('rejects unknown and mistyped fields without adding anything', async () => {
    await expect(call('add_items', {
      items: [{ type: 'text', text: 'ok' }, { type: 'text', text: 'bad', colour: 'red' }],
    })).rejects.toThrow(/"colour" is not a field of text items/)
    await expect(call('add_items', { items: [{ type: 'shape', width: '200' }] }))
      .rejects.toThrow(/"width" must be a number/)
    await expect(call('add_items', { items: [{ type: 'text', textAlign: 'middle' }] }))
      .rejects.toThrow(/textAlign/)
    expect(store().items).toHaveLength(0)
  })

  it('update_items patches fields and moves items between slides by number', async () => {
    await call('add_items', { items: [{ type: 'text', text: 'A' }] })
    await call('add_slide', {})
    const id = store().items[0]!.id
    await call('update_items', { updates: [{ id, text: 'B', slide: 2 }] })
    const item = store().items[0]!
    expect(item.text).toBe('B')
    expect(item.slideId).toBe(store().slides[1]!.id)
    // Media-only fields don't apply to text.
    await expect(call('update_items', { updates: [{ id, opacity: 0.5 }] })).rejects.toThrow(/opacity/)
    await expect(call('update_items', { updates: [{ id: 'nope', x: 1 }] })).rejects.toThrow(/No item/)
  })

  it('a solid background replaces a vibe; a named palette sets one', async () => {
    await call('update_slide', { slide: 1, vibe: { palette: 'Ocean' } })
    expect(store().slides[0]!.bgVibe?.palette[0]).toBe('#03045E')
    await call('update_slide', { slide: 1, bgColor: '#ffffff' })
    expect(store().slides[0]!.bgVibe).toBeUndefined()
    await expect(call('update_slide', { slide: 1, vibe: { palette: 'Nope' } })).rejects.toThrow(/Unknown palette/)
  })

  it('new_project refuses to drop unsaved work unless told to', async () => {
    await call('add_items', { items: [{ type: 'text', text: 'draft' }] })
    expect(store().isDirty).toBe(true)
    await expect(call('new_project', { preset: '9:16' })).rejects.toThrow(/unsaved changes/)
    await call('new_project', { preset: '9:16', discard_unsaved: true })
    expect(store().items).toHaveLength(0)
    expect(store().dimensions).toEqual({ width: 1080, height: 1920 })
    expect(store().isDirty).toBe(false)
  })

  it('refuses edits while an export is running, but still reads', async () => {
    const busy = makeCtx({ isBusy: () => true })
    await expect(call('add_slide', {}, busy)).rejects.toThrow(/exporting/)
    await expect(call('get_project', {}, busy, false)).resolves.toBeTruthy()
  })

  it('save_project needs a name for a never-saved document', async () => {
    await expect(call('save_project', {}, makeCtx(), false)).rejects.toThrow(/name/)
  })

  it('reorder_layers demands every id on the slide exactly once', async () => {
    await call('add_items', { items: [{ type: 'text', text: 'A' }, { type: 'shape' }] })
    const [a, b] = store().items.map((i) => i.id)
    await expect(call('reorder_layers', { slide: 1, ids: [a] })).rejects.toThrow(/exactly once/)
    await call('reorder_layers', { slide: 1, ids: [b, a] })
    expect(store().items.map((i) => i.id)).toEqual([b, a])
  })
})
