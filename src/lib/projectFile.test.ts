import { describe, it, expect } from 'vitest'
import {
  serializeProject,
  deserializeProject,
  hydrateItems,
  VPOST_FORMAT,
  VPOST_VERSION,
  type SerializeInput,
} from './projectFile'
import { createZip } from './zip'
import type { PlacedMedia } from '../store/useTiovivoStore'

/** Minimal but complete PlacedMedia for tests. */
function makeItem(overrides: Partial<PlacedMedia>): PlacedMedia {
  return {
    id: 'item-1',
    slideId: 'slide-1',
    type: 'image',
    src: 'blob:orig-1',
    name: 'photo.png',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    rotation: 0,
    naturalWidth: 600,
    naturalHeight: 400,
    brightness: 0,
    contrast: 0,
    saturation: 1,
    blur: 0,
    flipX: false,
    flipY: false,
    cropX: 0,
    cropY: 0,
    cropW: 0,
    cropH: 0,
    coverTime: 0,
    trimStart: 0,
    trimEnd: 0,
    ...overrides,
  }
}

function makeInput(items: PlacedMedia[], extra?: Partial<SerializeInput>): SerializeInput {
  return {
    slides: [{ id: 'slide-1', bgColor: '#ffffff', exportEnabled: true }],
    items,
    dimensions: { width: 1080, height: 1440 },
    presetId: '3:4',
    customWidth: 1080,
    customHeight: 1440,
    workspaceBgColor: '#0a0a0e',
    ...extra,
  }
}

const pngBlob = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

async function roundTrip(input: SerializeInput, blobs: Record<string, Blob>) {
  const file = await serializeProject(input, async (src) => {
    const b = blobs[src]
    if (!b) throw new Error(`test: no blob for ${src}`)
    return b
  })
  return deserializeProject(new Uint8Array(await file.arrayBuffer()))
}

describe('serializeProject / deserializeProject round-trip', () => {
  it('preserves manifest fields and stores asset bytes', async () => {
    const input = makeInput([makeItem({})], {
      guides: {
        showGrid: true, gridSize: 40, gridOpacity: 0.1, showCenterGuides: false,
        seamlessSlides: true, showHiddenZone: true, showIgSafeArea: false,
        marginPct: 4, snapGrid: false, snapCenter: true, snapItems: true, snapMargins: true,
      },
    })
    const { manifest, assetBlobs } = await roundTrip(input, { 'blob:orig-1': pngBlob() })

    expect(manifest.format).toBe(VPOST_FORMAT)
    expect(manifest.version).toBe(VPOST_VERSION)
    expect(manifest.dimensions).toEqual({ width: 1080, height: 1440 })
    expect(manifest.presetId).toBe('3:4')
    expect(manifest.workspaceBgColor).toBe('#0a0a0e')
    expect(manifest.slides).toHaveLength(1)
    expect(manifest.guides?.seamlessSlides).toBe(true)

    expect(manifest.assets).toHaveLength(1)
    const asset = manifest.assets[0]!
    expect(asset.mime).toBe('image/png')
    expect(asset.path).toMatch(/^assets\/a1\.png$/)

    expect(assetBlobs.size).toBe(1)
    const stored = assetBlobs.get(asset.id)!
    expect(stored.type).toBe('image/png')
    expect(stored.size).toBe(4)

    // Items lose their src and gain an assetId
    expect(manifest.items[0]!.assetId).toBe(asset.id)
    expect('src' in manifest.items[0]!).toBe(false)
  })

  it('dedupes assets shared by multiple items', async () => {
    const input = makeInput([
      makeItem({ id: 'i1', src: 'blob:shared' }),
      makeItem({ id: 'i2', src: 'blob:shared' }),
    ])
    const { manifest } = await roundTrip(input, { 'blob:shared': pngBlob() })
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.items[0]!.assetId).toBe(manifest.items[1]!.assetId)
  })

  it('stores video cover images as separate assets', async () => {
    const input = makeInput([
      makeItem({ type: 'video', src: 'blob:vid', coverImageSrc: 'blob:cover', name: 'clip.mp4' }),
    ])
    const { manifest, assetBlobs } = await roundTrip(input, {
      'blob:vid': new Blob([new Uint8Array(8)], { type: 'video/mp4' }),
      'blob:cover': pngBlob(),
    })
    expect(manifest.assets).toHaveLength(2)
    expect(manifest.items[0]!.coverAssetId).toBeDefined()
    expect(assetBlobs.size).toBe(2)
  })

  it('serializes text items without any asset', async () => {
    const input = makeInput([
      makeItem({ type: 'text', src: '', text: 'Hello', fontFamily: 'Inter', fontSize: 64 }),
    ])
    // getAssetBlob must never be called for text items
    const file = await serializeProject(input, async () => {
      throw new Error('should not be called')
    })
    const { manifest, assetBlobs } = deserializeProject(new Uint8Array(await file.arrayBuffer()))
    expect(manifest.assets).toHaveLength(0)
    expect(assetBlobs.size).toBe(0)
    expect(manifest.items[0]!.text).toBe('Hello')
    expect(manifest.items[0]!.assetId).toBeUndefined()
  })

  it('embeds the optional preview.png', async () => {
    const preview = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const file = await serializeProject(makeInput([], { preview }), async () => pngBlob())
    // preview.png is not a manifest asset, but must be present in the archive
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { manifest } = deserializeProject(bytes)
    expect(manifest.assets).toHaveLength(0)
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('preview.png')
  })
})

describe('deserializeProject error handling', () => {
  it('rejects archives without project.json', async () => {
    const zip = await createZip([{ name: 'foo.txt', data: new Blob(['x']) }])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(() => deserializeProject(bytes)).toThrow(/missing project\.json/)
  })

  it('rejects invalid JSON manifests', async () => {
    const zip = await createZip([{ name: 'project.json', data: new Blob(['{not json']) }])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(() => deserializeProject(bytes)).toThrow(/not valid JSON/)
  })

  it('rejects unknown formats', async () => {
    const zip = await createZip([
      { name: 'project.json', data: new Blob([JSON.stringify({ format: 'other', version: 1 })]) },
    ])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(() => deserializeProject(bytes)).toThrow(/Unsupported file format/)
  })

  it('rejects manifests from a newer app version', async () => {
    const zip = await createZip([
      { name: 'project.json', data: new Blob([JSON.stringify({ format: 'vpost', version: VPOST_VERSION + 1 })]) },
    ])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(() => deserializeProject(bytes)).toThrow(/Unsupported project version/)
  })

  it('rejects archives with a missing asset file', async () => {
    const manifest = {
      format: 'vpost',
      version: 1,
      dimensions: { width: 100, height: 100 },
      presetId: 'custom',
      customWidth: 100,
      customHeight: 100,
      slides: [],
      items: [],
      assets: [{ id: 'a1', name: 'x.png', mime: 'image/png', path: 'assets/a1.png' }],
    }
    const zip = await createZip([
      { name: 'project.json', data: new Blob([JSON.stringify(manifest)]) },
    ])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    expect(() => deserializeProject(bytes)).toThrow(/Missing asset in archive/)
  })
})

describe('hydrateItems', () => {
  it('rebuilds media srcs from the asset URL map and passes text through', async () => {
    const input = makeInput([
      makeItem({ id: 'i1', src: 'blob:orig-1' }),
      makeItem({ id: 'i2', type: 'text', src: '', text: 'Hi' }),
    ])
    const { manifest } = await roundTrip(input, { 'blob:orig-1': pngBlob() })
    const assetId = manifest.items[0]!.assetId!

    const hydrated = hydrateItems(manifest, new Map([[assetId, 'blob:rehydrated']]))
    expect(hydrated[0]!.src).toBe('blob:rehydrated')
    expect(hydrated[1]!.src).toBe('')
    expect(hydrated[1]!.text).toBe('Hi')
  })

  it('throws when a media item has no URL', async () => {
    const input = makeInput([makeItem({})])
    const { manifest } = await roundTrip(input, { 'blob:orig-1': pngBlob() })
    expect(() => hydrateItems(manifest, new Map())).toThrow(/No URL for assetId/)
  })
})
