// Curated fallback used when the Local Font Access API is unavailable or
// the user denies the permission. Order is alphabetical with system-ui first
// so a sensible default shows at the top.
export const FALLBACK_FONTS: string[] = [
  'system-ui',
  'Arial',
  'Arial Black',
  'Brush Script MT',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Helvetica',
  'Helvetica Neue',
  'Impact',
  'Inter',
  'Lucida Console',
  'Palatino',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]

let cached: string[] | null = null
let inFlight: Promise<string[]> | null = null

interface FontDataLike {
  family: string
  fullName?: string
  postscriptName?: string
  style?: string
}

/**
 * Returns a deduplicated, alphabetically sorted list of font family names
 * available on the host machine. Uses the Local Font Access API
 * (queryLocalFonts) when available, falling back to a curated list.
 *
 * Must be invoked from a user gesture handler on the first call —
 * Chromium gates queryLocalFonts() behind a transient user activation.
 */
export async function listSystemFonts(): Promise<string[]> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = (async () => {
    const w = window as Window & {
      queryLocalFonts?: () => Promise<FontDataLike[]>
    }
    if (typeof w.queryLocalFonts === 'function') {
      try {
        const fonts = await w.queryLocalFonts()
        const families = Array.from(new Set(fonts.map((f) => f.family)))
        families.sort((a, b) => a.localeCompare(b))
        cached = families
        return families
      } catch (err) {
        console.warn('[fonts] queryLocalFonts failed, using fallback list:', err)
      }
    }
    cached = FALLBACK_FONTS
    return FALLBACK_FONTS
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
