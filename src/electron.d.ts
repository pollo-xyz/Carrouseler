export interface ElectronAPI {
  saveFile: (options: {
    defaultName: string
    filters: { name: string; extensions: string[] }[]
    buffer?: Uint8Array
  }) => Promise<string | null>

  pickDirectory: () => Promise<string | null>

  openFile: (options: {
    filters: { name: string; extensions: string[] }[]
  }) => Promise<{ path: string; buffer: Uint8Array } | null>

  getRecents: () => Promise<string[]>
  openRecent: (filePath: string) => Promise<void>
  clearRecents: () => Promise<void>

  windowMinimize: () => Promise<void>
  windowMaximizeToggle: () => Promise<void>
  windowClose: () => Promise<void>

  writeFile: (options: {
    path: string
    buffer: Uint8Array
  }) => Promise<string>

  saveFilesToDir: (options: {
    dirPath: string
    files: { name: string; buffer: Uint8Array }[]
  }) => Promise<number>

  startVideoEncode: (options: {
    sessionId: string
    width: number
    height: number
    fps: number
    duration: number
    outputPath: string
  }) => Promise<{ ok: boolean }>

  videoFrame: (options: {
    sessionId: string
    frameData: Uint8Array
  }) => Promise<void>

  endVideoEncode: (options: {
    sessionId: string
  }) => Promise<string>

  getEncoderDiagnostics: () => Promise<{
    ffmpegPath: string
    availableH264Encoders: string[]
    probeAttempts: { encoder: string; exitCode: number; stderr: string }[]
    chosen: string
  } | null>

  extractCoverFrame: (options: {
    videoPath: string
    time: number
    outputPath: string
    width: number
    height: number
  }) => Promise<string>

  onUndo: (cb: () => void) => () => void
  onRedo: (cb: () => void) => () => void

  onNewProject: (cb: () => void) => () => void
  onOpenProject: (cb: () => void) => () => void
  onSaveProject: (cb: () => void) => () => void
  onSaveProjectAs: (cb: () => void) => () => void

  /** Main asks: is the current document dirty? Reply with sendDirtyResponse. */
  onQueryDirty: (cb: () => void) => () => void
  sendDirtyResponse: (isDirty: boolean) => void

  /** Main asks the renderer to save and report success so the window can
   *  finish closing. Reply with sendSaveResult(true|false). */
  onSaveAndClose: (cb: () => void) => () => void
  sendSaveResult: (ok: boolean) => void

  onOpenProjectFile: (
    cb: (payload: { path: string; buffer: Uint8Array }) => void,
  ) => () => void

  /** Park slide PNG/MP4 bytes in a temp file ahead of an OS drag. */
  prepareSlideDrag: (options: {
    filename: string
    buffer: Uint8Array
  }) => Promise<string>

  /** Trigger an OS-level drag. Must be called inside the dragstart handler. */
  startSlideDrag: (options: {
    filePath: string
    iconDataUrl: string
  }) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
