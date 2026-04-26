export interface ElectronAPI {
  saveFile: (options: {
    defaultName: string
    filters: { name: string; extensions: string[] }[]
    buffer: Uint8Array
  }) => Promise<string | null>

  pickDirectory: () => Promise<string | null>

  openFile: (options: {
    filters: { name: string; extensions: string[] }[]
  }) => Promise<{ path: string; buffer: Uint8Array } | null>

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

  onOpenProjectFile: (
    cb: (payload: { path: string; buffer: Uint8Array }) => void,
  ) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
