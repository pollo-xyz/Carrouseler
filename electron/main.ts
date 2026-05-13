import { app, BrowserWindow, ipcMain, dialog, Menu, session as electronSession } from 'electron'
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

/** Encoder we'll use for libx264-fallback video export — probed once and
 *  cached. Priority: NVIDIA NVENC → Intel QSV → AMD AMF → libx264 (CPU). */
type EncoderName = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264'
let cachedEncoder: EncoderName | null = null
let encoderProbePromise: Promise<EncoderName> | null = null

export interface EncoderDiagnostics {
  ffmpegPath: string
  /** Names of every h264 encoder that ffmpeg lists as compiled in. */
  availableH264Encoders: string[]
  /** Per-candidate probe results, in priority order, ending at the first
   *  success (or running through all if none worked). */
  probeAttempts: { encoder: EncoderName; exitCode: number; stderr: string }[]
  /** Final pick. */
  chosen: EncoderName
}
let cachedDiagnostics: EncoderDiagnostics | null = null

/** Run ffmpeg with optional stdin bytes; captures stderr.
 *  Resolves with {code, stderr}. */
function runFfmpegWithStdin(
  args: string[],
  stdinBytes: Buffer | null,
  timeoutMs = 10000,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), args, {
      stdio: [stdinBytes ? 'pipe' : 'ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      // Keep the tail bounded so a chatty failure doesn't balloon memory.
      if (stderr.length > 16384) stderr = stderr.slice(-16384)
    })
    const t = setTimeout(() => {
      try { proc.kill() } catch { /* ignore */ }
      resolve({ code: 1, stderr: stderr + '\n[probe timed out]' })
    }, timeoutMs)
    proc.on('error', (err) => { clearTimeout(t); resolve({ code: 1, stderr: stderr + '\n' + String(err) }) })
    proc.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, stderr }) })
    if (stdinBytes) {
      proc.stdin!.write(stdinBytes)
      proc.stdin!.end()
    }
  })
}

/** Ask ffmpeg which h264 encoders it knows about. Output looks like:
 *      V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC ...
 *      V....D h264_nvenc           NVIDIA NVENC H.264 encoder ...
 *  We grep for the codec names we care about on stdout. */
async function listAvailableH264EncodersFromStdout(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let stdout = ''
    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on('error', () => resolve([]))
    proc.on('close', () => {
      const wanted = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']
      resolve(wanted.filter((name) => stdout.includes(name)))
    })
  })
}

/** Try each hardware encoder by piping real rgba frames through it — exactly
 *  the path the live exporter uses. lavfi/`color` inputs are already YUV and
 *  hide rgba→yuv conversion failures, so we feed actual rgba bytes here.
 *  First encoder that exits zero is what we use. Falls back to libx264. */
async function probeEncoder(): Promise<EncoderName> {
  if (cachedEncoder) return cachedEncoder
  if (encoderProbePromise) return encoderProbePromise
  encoderProbePromise = (async () => {
    const diagnostics: EncoderDiagnostics = {
      ffmpegPath: getFfmpegPath(),
      availableH264Encoders: [],
      probeAttempts: [],
      chosen: 'libx264',
    }
    console.log(`[ffmpeg] binary path: ${diagnostics.ffmpegPath}`)

    // List which h264 encoders are even compiled into this ffmpeg build.
    // If h264_nvenc isn't here, ffmpeg-static doesn't ship the NVENC wrapper
    // for this build — we know to skip NVENC immediately.
    try {
      diagnostics.availableH264Encoders = await listAvailableH264EncodersFromStdout()
      console.log('[ffmpeg] compiled h264 encoders:', diagnostics.availableH264Encoders.join(', ') || '(none detected)')
    } catch (err) {
      console.log('[ffmpeg] failed to list encoders:', err)
    }

    const PROBE_W = 256, PROBE_H = 256, PROBE_FRAMES = 3
    // 3 frames of opaque black rgba. Tiny enough to be fast (~750 KB total),
    // big enough to exercise the rgba→yuv420p / nv12 conversion path that
    // hardware encoders typically use.
    const frame = Buffer.alloc(PROBE_W * PROBE_H * 4)
    for (let i = 0; i < frame.length; i += 4) {
      frame[i] = 0; frame[i + 1] = 0; frame[i + 2] = 0; frame[i + 3] = 255
    }
    const stdin = Buffer.concat([frame, frame, frame])

    const candidates: EncoderName[] = ['h264_nvenc', 'h264_qsv', 'h264_amf']
    for (const enc of candidates) {
      // Skip candidates that aren't even compiled in — saves a 10s timeout.
      if (
        diagnostics.availableH264Encoders.length > 0 &&
        !diagnostics.availableH264Encoders.includes(enc)
      ) {
        console.log(`[ffmpeg] ${enc} not compiled into this ffmpeg build — skipping`)
        diagnostics.probeAttempts.push({
          encoder: enc,
          exitCode: -1,
          stderr: 'encoder not compiled into ffmpeg-static build',
        })
        continue
      }
      const { code, stderr } = await runFfmpegWithStdin([
        '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'rgba',
        '-video_size', `${PROBE_W}x${PROBE_H}`,
        '-framerate', '30',
        '-i', 'pipe:0',
        ...encoderArgs(enc),
        '-frames:v', String(PROBE_FRAMES),
        '-f', 'null', '-',
      ], stdin)
      diagnostics.probeAttempts.push({ encoder: enc, exitCode: code, stderr })
      if (code === 0) {
        cachedEncoder = enc
        diagnostics.chosen = enc
        cachedDiagnostics = diagnostics
        console.log(`[ffmpeg] hardware encoder available: ${enc}`)
        return enc
      }
      // Log the last ~800 chars of stderr — that's where the actual error
      // line lives (e.g. "Cannot load nvcuda.dll", "No NVENC capable devices
      // found", "h264_qsv: Failed to load MFX (mfxLoad)").
      console.log(
        `[ffmpeg] encoder ${enc} failed probe (exit ${code}); trying next` +
        (stderr ? `\n  --- last stderr ---\n  ${stderr.slice(-800).replace(/\n/g, '\n  ')}` : ''),
      )
    }
    cachedEncoder = 'libx264'
    diagnostics.chosen = 'libx264'
    cachedDiagnostics = diagnostics
    console.log('[ffmpeg] no GPU encoder available — using libx264')
    return 'libx264'
  })()
  return encoderProbePromise
}

/** Expose probe diagnostics to the renderer so the user can see them via
 *  View → Toggle Developer Tools without needing to launch from a terminal. */
ipcMain.handle('get-encoder-diagnostics', async (): Promise<EncoderDiagnostics | null> => {
  // Ensure the probe has completed (or run it now if it somehow hasn't).
  await probeEncoder()
  return cachedDiagnostics
})

/** Build ffmpeg args tail (codec + quality flags) for the chosen encoder. */
function encoderArgs(enc: EncoderName): string[] {
  switch (enc) {
    case 'h264_nvenc':
      // p4 is the "medium-ish" NVENC preset (quality/speed balance).
      // -cq is constant-quality (CRF-equivalent) for VBR.
      return [
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',
        '-rc', 'vbr',
        '-cq', '20',
        '-pix_fmt', 'yuv420p',
      ]
    case 'h264_qsv':
      // Intel QSV. nv12 is its native pixel format — ffmpeg auto-converts.
      return [
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-global_quality', '23',
        '-pix_fmt', 'nv12',
      ]
    case 'h264_amf':
      return [
        '-c:v', 'h264_amf',
        '-quality', 'speed',
        '-rc', 'cqp',
        '-qp_i', '20',
        '-qp_p', '22',
        '-pix_fmt', 'yuv420p',
      ]
    case 'libx264':
    default:
      // superfast was chosen over fast: ~2× faster, +10–25% file size at
      // the same CRF. CRF bumped from 18 → 20 to claw most of that back.
      return [
        '-c:v', 'libx264',
        '-preset', 'superfast',
        '-crf', '20',
        '-pix_fmt', 'yuv420p',
      ]
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

// Pending file path to open once the renderer is ready (Finder double-click,
// "Open With", or argv-on-launch). On macOS the open-file event can fire
// before app.whenReady(), so we queue here and flush after window load.
let pendingOpenPath: string | null = null
let rendererReady = false

function deliverPendingOpen() {
  if (!pendingOpenPath || !win) return
  try {
    const buffer = fs.readFileSync(pendingOpenPath)
    win.webContents.send('app:open-project-file', {
      path: pendingOpenPath,
      buffer: new Uint8Array(buffer),
    })
    pendingOpenPath = null
  } catch (err) {
    console.error('[open-file] read failed:', err)
  }
}

function queueOpenPath(filePath: string) {
  pendingOpenPath = filePath
  if (rendererReady) deliverPendingOpen()
}

function createWindow() {
  // icon.png lives at the project root. In dev __dirname is `dist-electron/`;
  // in the packaged app it's `app.asar/dist-electron/`. Both resolve to the
  // root via `..` because the build config includes icon.png in `files`.
  const iconPath = path.join(__dirname, '..', 'icon.png')
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0e',
    icon: iconPath,
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

  win.webContents.on('did-finish-load', () => {
    rendererReady = true
    deliverPendingOpen()
  })
  win.on('closed', () => {
    rendererReady = false
  })
}

// Build a custom app menu so Cmd/Ctrl+Z reaches our renderer instead of being
// swallowed by the default Edit → Undo role (which only undoes text input).
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const sendToFocused = (channel: string) => {
    const w = BrowserWindow.getFocusedWindow() ?? win
    w?.webContents.send(channel)
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToFocused('app:new-project'),
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused('app:open-project'),
        },
        { type: 'separator' },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToFocused('app:save-project'),
        },
        {
          label: 'Save Project As…',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => sendToFocused('app:save-project-as'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendToFocused('app:undo'),
        },
        {
          label: 'Redo',
          accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
          click: () => sendToFocused('app:redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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

// macOS: Finder hands us paths via this event (fires before whenReady on
// cold-launch via double-click, and at any time during runtime via Open With).
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!filePath.toLowerCase().endsWith('.vpost')) return
  queueOpenPath(filePath)
})

// Single-instance: when a second launch happens (e.g. user double-clicks
// another .vpost while app is running on Win/Linux), focus the existing
// window and pick up the new path from argv.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const fileArg = argv.find((a) => a.toLowerCase().endsWith('.vpost'))
    if (fileArg) queueOpenPath(fileArg)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  // Cold-launch with file argument (Win/Linux; macOS uses open-file event).
  if (process.platform !== 'darwin') {
    const fileArg = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.vpost'))
    if (fileArg && fs.existsSync(fileArg)) queueOpenPath(fileArg)
  }
  // Probe ffmpeg encoders in the background so the first video export
  // doesn't pay the ~150–500ms detection cost. Result is cached.
  void probeEncoder()
  // Auto-grant Local Font Access so the text tool can list installed fonts.
  // queryLocalFonts() is gated by a permission; we trust ourselves.
  // We register both handlers: some Chromium code paths check before requesting
  // and skip the request entirely if the check returns false.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'local-fonts') return callback(true)
    callback(false)
  })
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'local-fonts') return true
    return false
  })
  buildMenu()
  createWindow()
})

/* ------------------------------------------------------------------ */
/*  IPC handlers — file operations                                    */
/* ------------------------------------------------------------------ */

// Save a single file with a save dialog. When `buffer` is omitted, the caller
// just wants the chosen path back (e.g. ffmpeg writes the file itself).
ipcMain.handle('save-file', async (_event, options: {
  defaultName: string
  filters: { name: string; extensions: string[] }[]
  buffer?: Uint8Array
}) => {
  const result = await dialog.showSaveDialog({
    defaultPath: options.defaultName,
    filters: options.filters,
  })
  if (result.canceled || !result.filePath) return null
  if (options.buffer) fs.writeFileSync(result.filePath, Buffer.from(options.buffer))
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

// Open a single file with an open dialog
ipcMain.handle('open-file', async (_event, options: {
  filters: { name: string; extensions: string[] }[]
}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options.filters,
  })
  if (result.canceled || !result.filePaths.length) return null
  const filePath = result.filePaths[0]!
  const buffer = fs.readFileSync(filePath)
  return { path: filePath, buffer: new Uint8Array(buffer) }
})

// Write a buffer to a known path (no dialog)
ipcMain.handle('write-file', async (_event, options: {
  path: string
  buffer: Uint8Array
}) => {
  fs.writeFileSync(options.path, Buffer.from(options.buffer))
  return options.path
})

/* ------------------------------------------------------------------ */
/*  IPC handlers — video encoding via ffmpeg                          */
/* ------------------------------------------------------------------ */

interface EncodeSession {
  proc: ChildProcess
  outputPath: string
  promise: Promise<string>
  encoder: EncoderName
  /** Set when ffmpeg exits before stdin.end() was called — i.e. it crashed.
   *  The renderer is notified so its pending videoFrame promises can reject. */
  crashed: boolean
  /** Tail of stderr — surfaced in error messages and used to diagnose. */
  stderr: string
  /** True after endVideoEncode closes stdin; subsequent proc.close is
   *  expected and shouldn't be treated as a crash. */
  ended: boolean
}

const encodeSessions = new Map<string, EncodeSession>()

function notifySessionFailed(sessionId: string, code: number | null, stderr: string) {
  const w = BrowserWindow.getAllWindows()[0]
  w?.webContents.send('app:session-failed', { sessionId, code, stderr })
}

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

  const encoder = await probeEncoder()
  const proc = spawn(ffmpeg, [
    '-y',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    ...encoderArgs(encoder),
    '-movflags', '+faststart',
    outputPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] })

  const session: EncodeSession = {
    proc,
    outputPath,
    encoder,
    crashed: false,
    ended: false,
    stderr: '',
    promise: null as unknown as Promise<string>,
  }
  encodeSessions.set(sessionId, session)

  // Live-forward ffmpeg stderr so a hang is no longer silent — devs can see
  // the actual error in the main-process console. We keep a tail for the
  // reject() message too.
  proc.stderr?.on('data', (chunk: Buffer) => {
    const s = chunk.toString()
    session.stderr += s
    // Cap the stored stderr so a chatty ffmpeg doesn't balloon memory over
    // a long export. Keep the last ~8 KB which is plenty for diagnostics.
    if (session.stderr.length > 8192) {
      session.stderr = session.stderr.slice(-8192)
    }
    console.log(`[ffmpeg:${sessionId.slice(0, 8)}] ${s.trimEnd()}`)
  })

  session.promise = new Promise<string>((resolve, reject) => {
    proc.on('close', (code) => {
      encodeSessions.delete(sessionId)
      const crashed = !session.ended && code !== 0
      if (crashed) {
        session.crashed = true
        // If a hardware encoder crashed before we even called end(), it's
        // not actually working at runtime. Demote so the next slide retries
        // with libx264 automatically.
        if (session.encoder !== 'libx264') {
          console.warn(`[ffmpeg] ${session.encoder} crashed mid-stream — falling back to libx264 for remaining slides`)
          cachedEncoder = 'libx264'
        }
        // Surface the failure to the renderer so its pending videoFrame
        // promises reject instead of hanging on an ack that won't come.
        notifySessionFailed(sessionId, code, session.stderr)
      }
      if (code === 0) resolve(outputPath)
      else reject(new Error(`ffmpeg exited with code ${code}: ${session.stderr}`))
    })
    proc.on('error', (err) => {
      encodeSessions.delete(sessionId)
      session.crashed = true
      notifySessionFailed(sessionId, -1, String(err))
      reject(err)
    })
  })

  return { ok: true, encoder }
})

// Send a raw RGBA frame to the ffmpeg process. Acks once stdin has consumed
// the bytes so the renderer can pipeline writes with a 1-frame queue.
ipcMain.handle('video-frame', async (_event, options: {
  sessionId: string
  frameData: Uint8Array
}) => {
  const session = encodeSessions.get(options.sessionId)
  if (!session) throw new Error('No such encoding session')
  if (session.crashed) throw new Error('Session has already crashed')

  return new Promise<void>((resolve, reject) => {
    const buf = Buffer.from(options.frameData)
    const ok = session.proc.stdin!.write(buf, (err) => {
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

  // Mark as intentionally ended so proc.close isn't treated as a crash.
  session.ended = true
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
