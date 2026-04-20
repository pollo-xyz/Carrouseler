import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  /** Save a single file via native save dialog */
  saveFile: (options: {
    defaultName: string
    filters: { name: string; extensions: string[] }[]
    buffer: Uint8Array
  }) => ipcRenderer.invoke('save-file', options),

  /** Open a native directory picker */
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),

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
})
