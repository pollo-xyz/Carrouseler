/**
 * Thin REST wrapper over the Giphy public API. We hit four endpoints
 * (trending, search, sticker-trending, sticker-search) and that's it —
 * dropping the full JS SDK saves ~80 KB and the version-coupling that
 * comes with it.
 *
 * Auth: a single `?api_key=…` query param. We read the key from a Vite
 * env var so it can be supplied in `.env.local` (gitignored) during dev
 * and baked into electron-builder builds. When the key is missing the
 * picker shows an empty-state message rather than firing requests that
 * would 401 anyway.
 */

const API_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined
const BASE = 'https://api.giphy.com/v1'

export type GiphyKind = 'gifs' | 'stickers'

/** The trimmed-down shape of a Giphy result we actually use in the UI. */
export interface GiphyItem {
  id: string
  title: string
  /** The full-quality original — what we download and embed in the project. */
  url: string
  /** A small downsampled animation we show in the picker grid. */
  preview: string
  /** Natural pixel dimensions, used to size the item when placed on canvas. */
  width: number
  height: number
}

export function hasGiphyKey(): boolean {
  return !!API_KEY && API_KEY.length > 0
}

interface GiphyApiResponse {
  data: Array<{
    id: string
    title?: string
    images: {
      original?: { url: string; width: string; height: string }
      fixed_width?: { url: string; width: string; height: string }
      fixed_height_small?: { url: string }
      preview_gif?: { url: string }
    }
  }>
}

function toItems(raw: GiphyApiResponse): GiphyItem[] {
  return raw.data
    .filter((d) => d.images.original?.url)
    .map((d) => {
      const orig = d.images.original!
      // Picker preview prefers a small animated rendition. Fall back through
      // the various Giphy "rendition" tiers — older responses don't always
      // include every size.
      const previewUrl =
        d.images.fixed_width?.url ??
        d.images.fixed_height_small?.url ??
        d.images.preview_gif?.url ??
        orig.url
      return {
        id: d.id,
        title: d.title?.trim() || 'GIF',
        url: orig.url,
        preview: previewUrl,
        width: Number(orig.width) || 480,
        height: Number(orig.height) || 270,
      }
    })
}

async function get(path: string, params: Record<string, string | number>): Promise<GiphyItem[]> {
  if (!API_KEY) throw new Error('Giphy API key not set — define VITE_GIPHY_API_KEY in .env.local')
  const q = new URLSearchParams({
    api_key: API_KEY,
    rating: 'g',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  const res = await fetch(`${BASE}${path}?${q.toString()}`)
  if (!res.ok) throw new Error(`Giphy ${path} failed: ${res.status} ${res.statusText}`)
  const json = (await res.json()) as GiphyApiResponse
  return toItems(json)
}

/** Trending GIFs / stickers — shown when the search box is empty. */
export function trending(kind: GiphyKind, limit = 24, offset = 0): Promise<GiphyItem[]> {
  return get(`/${kind}/trending`, { limit, offset })
}

/** Free-text search. */
export function search(kind: GiphyKind, query: string, limit = 24, offset = 0): Promise<GiphyItem[]> {
  return get(`/${kind}/search`, { q: query, limit, offset })
}

/**
 * Download a Giphy result's full original as a Blob — so adding it to a
 * project embeds the bytes in the .vpost rather than holding a remote URL
 * that could rot.
 */
export async function downloadGif(item: GiphyItem): Promise<Blob> {
  const res = await fetch(item.url)
  if (!res.ok) throw new Error(`Giphy download failed: ${res.status}`)
  return res.blob()
}
