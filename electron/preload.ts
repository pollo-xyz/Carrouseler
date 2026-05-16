import { contextBridge, ipcRenderer } from 'electron'

// Tracks in-flight video frames per session so a session-failed event can
// reject the pending promise instead of letting it hang on a missing reply.
const pendingFrames = new Map<string, Set<{
  reject: (e: Error) => void
}>>()
ipcRenderer.on('app:session-failed', (_e, payload: {
  sessionId: string
  code: number | null
  stderr: string
}) => {
  const set = pendingFrames.get(payload.sessionId)
  if (!set) return
  const err = new Error(
    `ffmpeg session ${payload.sessionId.slice(0, 8)} exited with code ${payload.code}` +
    (payload.stderr ? `:\n${payload.stderr.slice(-512)}` : ''),
  )
  for (const entry of set) entry.reject(err)
  pendingFrames.delete(payload.sessionId)
})

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

  /** Recently-opened .vpost project paths, newest first. Used by the
   *  in-app File menu on Windows/Linux (macOS uses the native menu). */
  getRecents: () => ipcRenderer.invoke('get-recents') as Promise<string[]>,
  openRecent: (filePath: string) => ipcRenderer.invoke('open-recent', filePath),
  clearRecents: () => ipcRenderer.invoke('clear-recents'),

  /** Custom title-bar window controls (Windows / Linux only). On macOS
   *  the native traffic-light buttons handle these. */
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window-maximize-toggle'),
  windowClose: () => ipcRenderer.invoke('window-close'),

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

  /** Send a raw RGBA frame to the encoding session. The promise resolves
   *  once ffmpeg has consumed the bytes (or rejects if the session crashes
   *  via the app:session-failed broadcast). */
  videoFrame: (options: {
    sessionId: string
    frameData: Uint8Array
  }) => {
    return new Promise<void>((resolve, reject) => {
      let bucket = pendingFrames.get(options.sessionId)
      if (!bucket) {
        bucket = new Set()
        pendingFrames.set(options.sessionId, bucket)
      }
      const entry = { reject }
      bucket.add(entry)
      const cleanup = () => {
        bucket!.delete(entry)
        if (bucket!.size === 0) pendingFrames.delete(options.sessionId)
      }
      ipcRenderer.invoke('video-frame', options)
        .then(() => { cleanup(); resolve() })
        .catch((err) => { cleanup(); reject(err as Error) })
    })
  },

  /** Finish encoding — returns the output file path */
  endVideoEncode: (options: {
    sessionId: string
  }) => ipcRenderer.invoke('end-video-encode', options),

  /** Returns the probe diagnostics: ffmpeg path, compiled encoders, and the
   *  per-candidate exit code + stderr from the probe. Useful for diagnosing
   *  why a hardware encoder wasn't selected. */
  getEncoderDiagnostics: () => ipcRenderer.invoke('get-encoder-diagnostics'),

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

  /** Main is asking whether the current document has unsaved changes. The
   *  renderer must respond via sendDirtyResponse() promptly — main times out
   *  after 1.5s and falls through to closing. */
  onQueryDirty: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:query-dirty', h)
    return () => ipcRenderer.off('app:query-dirty', h)
  },
  sendDirtyResponse: (isDirty: boolean) => ipcRenderer.send('app:dirty-response', isDirty),

  /** Main is asking the renderer to save the project, then signal whether
   *  the save succeeded so main can proceed with closing the window. */
  onSaveAndClose: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('app:save-and-close', h)
    return () => ipcRenderer.off('app:save-and-close', h)
  },
  sendSaveResult: (ok: boolean) => ipcRenderer.send('app:save-result', ok),

  /** Fired when the OS hands us a .vpost file (Finder double-click, Open With,
   * or argv-on-launch). Payload is the file path plus its bytes — main has
   * already read the file. */
  onOpenProjectFile: (cb: (payload: { path: string; buffer: Uint8Array }) => void) => {
    const h = (_e: unknown, payload: { path: string; buffer: Uint8Array }) => cb(payload)
    ipcRenderer.on('app:open-project-file', h)
    return () => ipcRenderer.off('app:open-project-file', h)
  },
})
