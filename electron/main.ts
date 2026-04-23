import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Resolve ffmpeg binary path
function getFfmpegPath(): string {
  try {
    // ffmpeg-static exports the path to the binary
    const p = require('ffmpeg-static') as string
    // In packaged app, the binary might be in app.asar.unpacked
    if (app.isPackaged) {
      return p.replace('app.asar', 'app.asar.unpacked')
    }
    return p
  } catch {
    return 'ffmpeg' // fallback to system ffmpeg
  }
}

// The built directory structure:
//  ├─ dist-electron/
//  │  └─ main.js
//  ├─ dist/
//  │  └─ index.html

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null = null
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)

/* ------------------------------------------------------------------ */
/*  IPC handlers — file operations                                    */
/* ------------------------------------------------------------------ */

// Save a single file with a save dialog
ipcMain.handle('save-file', async (_event, options: {
  defaultName: string
  filters: { name: string; extensions: string[] }[]
  buffer: Uint8Array
}) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultName,
    filters: options.filters,
  })
  if (result.canceled || !result.filePath) return null
  fs.writeFileSync(result.filePath, Buffer.from(options.buffer))
  return result.filePath
})

// Pick a directory
ipcMain.handle('pick-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

// Save multiple files to a directory
ipcMain.handle('save-files-to-dir', async (_event, options: {
  dirPath: string
  files: { name: string; buffer: Uint8Array }[]
}) => {
  for (const file of options.files) {
    const filePath = path.join(options.dirPath, file.name)
    fs.writeFileSync(filePath, Buffer.from(file.buffer))
  }
  return options.files.length
})

/* ------------------------------------------------------------------ */
/*  IPC handlers — video encoding via ffmpeg                          */
/* ------------------------------------------------------------------ */

interface EncodeSession {
  proc: ChildProcess
  outputPath: string
  promise: Promise<string>
}

const encodeSessions = new Map<string, EncodeSession>()

// Start a video encoding session — ffmpeg reads raw RGBA frames from stdin
ipcMain.handle('start-video-encode', async (_event, options: {
  sessionId: string
  width: number
  height: number
  fps: number
  duration: number
  outputPath: string
}) => {
  const ffmpeg = getFfmpegPath()
  const { sessionId, width, height, fps, outputPath } = options

  const proc = spawn(ffmpeg, [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '18',
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] })

  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  const promise = new Promise<string>((resolve, reject) => {
    proc.on('close', (code) => {
      encodeSessions.delete(sessionId)
      if (code === 0) resolve(outputPath)
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
    })
    proc.on('error', (err) => {
      encodeSessions.delete(sessionId)
      reject(err)
    })
  })

  encodeSessions.set(sessionId, { proc, outputPath, promise })
  return { ok: true }
})

// Send a raw RGBA frame to the ffmpeg process
ipcMain.handle('video-frame', async (_event, options: {
  sessionId: string
  frameData: Uint8Array
}) => {
  const session = encodeSessions.get(options.sessionId)
  if (!session) throw new Error('No such encoding session')

  return new Promise<void>((resolve, reject) => {
    const ok = session.proc.stdin!.write(Buffer.from(options.frameData), (err) => {
      if (err) reject(err)
      else resolve()
    })
    if (!ok) {
      session.proc.stdin!.once('drain', () => resolve())
    }
  })
})

// Finish encoding — close stdin, wait for ffmpeg to complete
ipcMain.handle('end-video-encode', async (_event, options: {
  sessionId: string
}) => {
  const session = encodeSessions.get(options.sessionId)
  if (!session) throw new Error('No such encoding session')

  session.proc.stdin!.end()
  const outputPath = await session.promise
  return outputPath
})

// Extract a single frame from an encoded video at a given time
ipcMain.handle('extract-cover-frame', async (_event, options: {
  videoPath: string
  time: number
  outputPath: string
  width: number
  height: number
}) => {
  const ffmpeg = getFfmpegPath()
  const { videoPath, time, outputPath, width, height } = options

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      '-y',
      '-ss', String(time),
      '-i', videoPath,
      '-frames:v', '1',
      '-s', `${width}x${height}`,
      outputPath,
    ])
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath)
      else reject(new Error(`ffmpeg frame extract failed: ${stderr}`))
    })
    proc.on('error', reject)
  })
})
