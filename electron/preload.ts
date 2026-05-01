import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  /** Save a single file via native save dialog. Omit buffer to get just the chosen path. */
  saveFile: (options: {
    defaultName: string
    filters: { name: string; extensions: string[] }[]
    buffer?: Uint8Array
  }) => ipcRenderer.invoke('save-file', options),

  /** Open a native directory picker */
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),

  /** Open a single file via native open dialog */
  openFile: (options: {
    filters: { name: string; extensions: string[] }[]
  }) => ipcRenderer.invoke('open-file', options) as Promise<{
    path: string
    buffer: Uint8Array
  } | null>,

  /** Write a buffer to a known path (no dialog) */
  writeFile: (options: {
    path: string
    buffer: Uint8Array
  }) => ipcRenderer.invoke('write-file', options) as Promise<string>,

  /** Save multiple files to a chosen directory */
  saveFilesToDir: (options: {
    dirPath: string
    files: { name: string; buffer: Uint8Array }[]
  }) => ipcRenderer.invoke('save-files-to-dir', options),

  /** Start a video encoding session (ffmpeg reads raw RGBA frames) */
  startVideoEncode: (options: {
    sessionId: string
    width: number
    height: number
    fps: number
    duration: number
    outputPath: string
  }) => ipcRenderer.invoke('start-video-encode', options),

  /** Send a raw RGBA frame to the encoding session */
  videoFrame: (options: {
    sessionId: string
    frameData: Uint8Array
  }) => ipcRenderer.invoke('video-frame', options),

  /** Finish encoding — returns the output file path */
  endVideoEncode: (options: {
    sessionId: string
  }) => ipcRenderer.invoke('end-video-encode', options),

  /** Extract a single frame from an encoded video as a PNG */
  extractCoverFrame: (options: {
    videoPath: string
    time: number
    outputPath: string
    width: number
    height: number
  }) => ipcRenderer.invoke('extract-cover-frame', options),

  /** Subscribe to Edit → Undo / Redo menu events from main. Returns an unsubscribe fn. */
  onUndo: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:undo', h)
    return () => ipcRenderer.off('app:undo', h)
  },
  onRedo: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:redo', h)
    return () => ipcRenderer.off('app:redo', h)
  },

  onNewProject: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:new-project', h)
    return () => ipcRenderer.off('app:new-project', h)
  },
  onOpenProject: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:open-project', h)
    return () => ipcRenderer.off('app:open-project', h)
  },
  onSaveProject: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:save-project', h)
    return () => ipcRenderer.off('app:save-project', h)
  },
  onSaveProjectAs: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:save-project-as', h)
    return () => ipcRenderer.off('app:save-project-as', h)
  },

  /** Fired when the OS hands us a .vpost file (Finder double-click, Open With,
   * or argv-on-launch). Payload is the file path plus its bytes — main has
   * already read the file. */
  onOpenProjectFile: (cb: (payload: { path: string; buffer: Uint8Array }) => void) => {
    const h = (_e: unknown, payload: { path: string; buffer: Uint8Array }) => cb(payload)
    ipcRenderer.on('app:open-project-file', h)
    return () => ipcRenderer.off('app:open-project-file', h)
  },
})
