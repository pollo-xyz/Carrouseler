import type { PresetId, Size } from './presets'
import type { MediaType, PlacedMedia, Slide } from '../store/useCarouselStore'
import { createZip, readZip } from './zip'

export const VPOST_FORMAT = 'vpost'
export const VPOST_VERSION = 1

export interface ProjectAsset {
  id: string
  name: string
  mime: string
  path: string
}

export interface ProjectManifest {
  format: typeof VPOST_FORMAT
  version: number
  app?: { name?: string; version?: string }
  dimensions: Size
  presetId: PresetId
  customWidth: number
  customHeight: number
  slides: Slide[]
  assets: ProjectAsset[]
  items: (Omit<PlacedMedia, 'src'> & { assetId: string })[]
}

export interface SerializeInput {
  slides: Slide[]
  items: PlacedMedia[]
  dimensions: Size
  presetId: PresetId
  customWidth: number
  customHeight: number
}

function extFromMime(mime: string, fallback: string): string {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'video/mp4') return 'mp4'
  if (mime === 'video/quicktime') return 'mov'
  if (mime === 'video/webm') return 'webm'
  return fallback || 'bin'
}

function extFromName(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export async function serializeProject(
  state: SerializeInput,
  getAssetBlob: (src: string) => Promise<Blob>,
): Promise<Blob> {
  const srcToAsset = new Map<string, ProjectAsset>()
  const assetBlobs: { name: string; data: Blob }[] = []

  let counter = 0
  for (const item of state.items) {
    if (srcToAsset.has(item.src)) continue
    const blob = await getAssetBlob(item.src)
    const id = `a${++counter}`
    const ext = extFromMime(blob.type, extFromName(item.name))
    const path = `assets/${id}.${ext}`
    srcToAsset.set(item.src, { id, name: item.name, mime: blob.type, path })
    assetBlobs.push({ name: path, data: blob })
  }

  const manifest: ProjectManifest = {
    format: VPOST_FORMAT,
    version: VPOST_VERSION,
    dimensions: state.dimensions,
    presetId: state.presetId,
    customWidth: state.customWidth,
    customHeight: state.customHeight,
    slides: state.slides,
    assets: Array.from(srcToAsset.values()),
    items: state.items.map((it) => {
      const { src: _src, ...rest } = it
      void _src
      return { ...rest, assetId: srcToAsset.get(it.src)!.id }
    }),
  }

  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  })

  return createZip([{ name: 'project.json', data: manifestBlob }, ...assetBlobs])
}

export interface DeserializedProject {
  manifest: ProjectManifest
  assetBlobs: Map<string, Blob>
}

export function deserializeProject(buffer: Uint8Array): DeserializedProject {
  const entries = readZip(buffer)
  const manifestEntry = entries.find((e) => e.name === 'project.json')
  if (!manifestEntry) throw new Error('Not a .vpost file: missing project.json')

  const text = new TextDecoder().decode(manifestEntry.data)
  let manifest: ProjectManifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error('project.json is not valid JSON')
  }

  if (manifest.format !== VPOST_FORMAT) {
    throw new Error(`Unsupported file format: ${manifest.format}`)
  }
  if (typeof manifest.version !== 'number' || manifest.version > VPOST_VERSION) {
    throw new Error(`Unsupported project version: ${manifest.version}. This app supports up to v${VPOST_VERSION}.`)
  }

  const byPath = new Map(entries.map((e) => [e.name, e.data]))
  const assetBlobs = new Map<string, Blob>()
  for (const asset of manifest.assets) {
    const data = byPath.get(asset.path)
    if (!data) throw new Error(`Missing asset in archive: ${asset.path}`)
    assetBlobs.set(asset.id, new Blob([data as BlobPart], { type: asset.mime }))
  }

  return { manifest, assetBlobs }
}

export function hydrateItems(
  manifest: ProjectManifest,
  assetUrls: Map<string, string>,
): PlacedMedia[] {
  return manifest.items.map((it) => {
    const url = assetUrls.get(it.assetId)
    if (!url) throw new Error(`No URL for assetId ${it.assetId}`)
    const { assetId: _aid, ...rest } = it
    void _aid
    return { ...rest, src: url, type: rest.type as MediaType }
  })
}
