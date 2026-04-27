/**
 * Global registry of HTMLVideoElement instances by item ID.
 * Allows the export pipeline to access and seek video elements
 * that are created inside React component hooks.
 */
export const videoElements = new Map<string, HTMLVideoElement>()

/**
 * Custom cover-image elements per video item ID, when the user has chosen
 * an image-from-disk to use as the cover instead of a video frame.
 * The export pipeline swaps these in for frame 0 capture.
 */
export const coverImageElements = new Map<string, HTMLImageElement>()
