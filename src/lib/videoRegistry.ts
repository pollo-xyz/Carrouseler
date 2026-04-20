/**
 * Global registry of HTMLVideoElement instances by item ID.
 * Allows the export pipeline to access and seek video elements
 * that are created inside React component hooks.
 */
export const videoElements = new Map<string, HTMLVideoElement>()
