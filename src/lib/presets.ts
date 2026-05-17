export type PresetId = 'hd' | '1:1' | '4:5' | '3:4' | '9:16' | 'custom'

export interface Size {
  width: number
  height: number
}

/** Long edge 1080px where Instagram cares; HD = 16:9 landscape reference,
 *  9:16 covers Stories / Reels / TikTok / YouTube Shorts. */
export const PRESETS: Record<Exclude<PresetId, 'custom'>, Size> = {
  hd: { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '3:4': { width: 1080, height: 1440 },
  '9:16': { width: 1080, height: 1920 },
}

export function clampSize(w: number, h: number, min = 64, max = 8192): Size {
  return {
    width: Math.round(Math.min(max, Math.max(min, w))),
    height: Math.round(Math.min(max, Math.max(min, h))),
  }
}
