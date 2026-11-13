/* Built-in MCP server — lets an agent (Claude Code, Claude Desktop, …) drive
 * the open document: build slides, look at renders, export.
 *
 * Transport: MCP "Streamable HTTP", stateless, JSON responses only — one
 * POST per JSON-RPC message, which is all a tools-only server needs. Hand
 * rolled on node:http so the packaged app gains no dependencies.
 *
 * Safety: off until the user switches it on; bound to 127.0.0.1; every
 * request needs the bearer token; browser origins are refused (a web page
 * can't reach it via DNS rebinding); files are only written inside the
 * output folder the user picked.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { TOOLS, INSTRUCTIONS } from './mcpTools'

const DEFAULT_PORT = 47821
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 4 * 1024 * 1024
const MAX_MEDIA_BYTES = 300 * 1024 * 1024

const MEDIA_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
}

interface McpConfig {
  enabled: boolean
  port: number
  token: string
  outputDir: string
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  outputDir: string
  /** Why the server isn't running although it's enabled (port taken, …). */
  error: string | null
}

export interface McpHost {
  getWindow: () => BrowserWindow | null
  /** Allow-list hooks into main's "only paths the user chose" guard. */
  allowFile: (p: string) => void
  allowDir: (p: string) => void
}

/** What a tool hands back from the renderer. */
interface ToolResult {
  json?: unknown
  text?: string
  image?: { data: string; mimeType: string }
}

const configPath = () => path.join(app.getPath('userData'), 'mcp.json')

function loadConfig(): McpConfig {
  const fallback: McpConfig = {
    enabled: false,
    port: DEFAULT_PORT,
    token: crypto.randomBytes(24).toString('base64url'),
    outputDir: path.join(app.getPath('documents'), 'Tiovivo'),
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<McpConfig>
    return {
      enabled: raw.enabled === true,
      port: Number.isInteger(raw.port) && raw.port! > 1023 && raw.port! < 65536 ? raw.port! : fallback.port,
      token: typeof raw.token === 'string' && raw.token.length >= 16 ? raw.token : fallback.token,
      outputDir: typeof raw.outputDir === 'string' && raw.outputDir ? raw.outputDir : fallback.outputDir,
    }
  } catch {
    return fallback // first run or unreadable file
  }
}

function safeName(name: string, fallback: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 80) || fallback
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

class ToolError extends Error {}

export function initMcp(host: McpHost) {
  let config = loadConfig()
  let server: http.Server | null = null
  let lastError: string | null = null

  const saveConfig = () => {
    try { fs.writeFileSync(configPath(), JSON.stringify(config, null, 2)) } catch { /* best-effort */ }
  }

  const status = (): McpStatus => ({
    enabled: config.enabled,
    running: !!server?.listening,
    url: `http://127.0.0.1:${config.port}/mcp`,
    token: config.token,
    outputDir: config.outputDir,
    error: lastError,
  })

  /* ---- renderer round trip ---- */
  const pending = new Map<string, { resolve: (r: ToolResult) => void; reject: (e: Error) => void }>()
  ipcMain.on('mcp:result', (_e, msg: { id: string; ok: boolean; result?: ToolResult; error?: string }) => {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result ?? {})
    else p.reject(new ToolError(msg.error || 'Tool failed'))
  })

  function callRenderer(tool: string, args: Record<string, unknown>, mutates: boolean, timeoutMs: number): Promise<ToolResult> {
    const win = host.getWindow()
    if (!win || win.isDestroyed()) {
      return Promise.reject(new ToolError('Tiovivo has no open window. Open the app window and try again.'))
    }
    const id = crypto.randomUUID()
    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new ToolError(`Tiovivo did not answer within ${Math.round(timeoutMs / 1000)}s.`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      win.webContents.send('mcp:call', { id, tool, args, mutates })
    })
  }

  /** Swap each image item's `path` for the file's bytes — the renderer is
   *  sandboxed from the disk, main does the reading. */
  async function attachMedia(items: unknown) {
    if (!Array.isArray(items)) return
    for (const it of items as Record<string, unknown>[]) {
      if (!it || it.type !== 'image') continue
      const p = it.path
      if (typeof p !== 'string' || !path.isAbsolute(p)) {
        throw new ToolError('Image items need `path`: the absolute path of a local file.')
      }
      const ext = path.extname(p).slice(1).toLowerCase()
      const mime = MEDIA_MIME[ext]
      if (!mime) throw new ToolError(`Unsupported media type ".${ext}" (${p}). Use ${Object.keys(MEDIA_MIME).join(', ')}.`)
      let stat: fs.Stats
      try { stat = await fs.promises.stat(p) } catch { throw new ToolError(`File not found: ${p}`) }
      if (!stat.isFile()) throw new ToolError(`Not a file: ${p}`)
      if (stat.size > MAX_MEDIA_BYTES) throw new ToolError(`File is larger than 300 MB: ${p}`)
      it.data = new Uint8Array(await fs.promises.readFile(p))
      it.mime = mime
      it.fileName = path.basename(p)
    }
  }

  async function runTool(name: string, rawArgs: unknown): Promise<ToolResult> {
    const def = TOOLS.find((t) => t.name === name)
    if (!def) throw new ToolError(`Unknown tool: ${name}`)
    const args: Record<string, unknown> =
      rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...(rawArgs as object) } : {}
    let timeout = 60_000

    if (name === 'add_slide' || name === 'add_items') {
      await attachMedia(args.items)
      timeout = 180_000
    } else if (name === 'export') {
      const prefix = safeName(typeof args.prefix === 'string' ? args.prefix : '', 'tiovivo')
      const folder = safeName(typeof args.folder === 'string' ? args.folder : '', `${prefix}_${timestamp()}`)
      const dir = path.join(config.outputDir, folder)
      await fs.promises.mkdir(dir, { recursive: true })
      host.allowDir(dir)
      args.dirPath = dir
      args.prefix = prefix
      timeout = 30 * 60_000 // video slides encode in real time
    } else if (name === 'save_project') {
      if (typeof args.name === 'string' && args.name.trim()) {
        const base = safeName(args.name.replace(/\.vpost$/i, ''), 'Untitled')
        await fs.promises.mkdir(config.outputDir, { recursive: true })
        const target = path.join(config.outputDir, `${base}.vpost`)
        host.allowFile(target)
        args.targetPath = target
      }
      timeout = 180_000
    }
    return callRenderer(name, args, def.mutates === true, timeout)
  }

  /* ---- JSON-RPC ---- */
  type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

  async function handleRpc(msg: Rpc): Promise<object | null> {
    // Notifications and stray responses carry no id / no method: nothing to answer.
    if (!msg || typeof msg.method !== 'string' || msg.id === undefined || msg.id === null) return null
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } })
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion
        const version = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]
        return ok({
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: 'tiovivo', title: 'Tiovivo', version: app.getVersion() },
          instructions: INSTRUCTIONS,
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        })
      case 'tools/call': {
        const name = msg.params?.name
        if (typeof name !== 'string') return fail(-32602, 'Missing tool name')
        try {
          const r = await runTool(name, msg.params?.arguments)
          const content: object[] = []
          if (r.json !== undefined) content.push({ type: 'text', text: JSON.stringify(r.json) })
          if (r.text) content.push({ type: 'text', text: r.text })
          if (r.image) content.push({ type: 'image', data: r.image.data, mimeType: r.image.mimeType })
          if (content.length === 0) content.push({ type: 'text', text: 'Done.' })
          return ok({ content })
        } catch (err) {
          // Tool failures are results the model can read and react to, not
          // protocol errors.
          const text = err instanceof Error ? err.message : String(err)
          return ok({ content: [{ type: 'text', text }], isError: true })
        }
      }
      default:
        return fail(-32601, `Method not found: ${msg.method}`)
    }
  }

  function authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization ?? ''
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '')
    const want = Buffer.from(config.token)
    return given.length === want.length && crypto.timingSafeEqual(given, want)
  }

  function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const send = (code: number, body?: object, headers: Record<string, string> = {}) => {
      const text = body ? JSON.stringify(body) : ''
      res.writeHead(code, { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers })
      res.end(text)
    }
    // A browser page always sends Origin; MCP clients don't. Refusing it
    // outright closes the DNS-rebinding door.
    if (req.headers.origin) return send(403, { error: 'Browser origins are not allowed' })
    const hostName = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (hostName !== '127.0.0.1' && hostName !== 'localhost') return send(403, { error: 'Bad host' })
    if ((req.url ?? '').split('?')[0] !== '/mcp') return send(404, { error: 'Not found' })
    if (!authorized(req)) return send(401, { error: 'Missing or wrong bearer token' }, { 'WWW-Authenticate': 'Bearer' })
    // No server-initiated stream and no sessions to end.
    if (req.method !== 'POST') return send(405, { error: 'Use POST' }, { Allow: 'POST' })

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { send(413, { error: 'Request too large' }); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
      const batch = Array.isArray(parsed)
      const messages = (batch ? parsed : [parsed]) as Rpc[]
      // One at a time: tools act on a single live document.
      void (async () => {
        const replies: object[] = []
        for (const m of messages) {
          const reply = await handleRpc(m)
          if (reply) replies.push(reply)
        }
        if (replies.length === 0) return send(202)
        send(200, batch ? replies : replies[0])
      })().catch((err) => {
        if (!res.writableEnded) send(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: String(err) } })
      })
    })
  }

  /* ---- lifecycle ---- */
  function stop(): Promise<void> {
    const s = server
    server = null
    if (!s) return Promise.resolve()
    return new Promise((resolve) => {
      s.close(() => resolve())
      s.closeAllConnections()
    })
  }

  function start(): Promise<void> {
    return new Promise((resolve) => {
      const s = http.createServer(onRequest)
      s.once('error', (err: NodeJS.ErrnoException) => {
        lastError = err.code === 'EADDRINUSE'
          ? `Port ${config.port} is in use by another program.`
          : err.message
        resolve()
      })
      s.listen(config.port, '127.0.0.1', () => {
        server = s
        lastError = null
        resolve()
      })
    })
  }

  async function apply() {
    await stop()
    lastError = null
    if (config.enabled) await start()
  }

  ipcMain.handle('mcp-get-status', async () => status())
  ipcMain.handle('mcp-set-enabled', async (_e, enabled: boolean) => {
    config = { ...config, enabled: enabled === true }
    saveConfig()
    await apply()
    return status()
  })
  ipcMain.handle('mcp-new-token', async () => {
    config = { ...config, token: crypto.randomBytes(24).toString('base64url') }
    saveConfig()
    return status()
  })
  ipcMain.handle('mcp-pick-output-dir', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Folder for projects and exports made through Claude',
      defaultPath: config.outputDir,
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
    if (!result.canceled && result.filePaths[0]) {
      config = { ...config, outputDir: result.filePaths[0] }
      saveConfig()
    }
    return status()
  })

  app.on('will-quit', () => { void stop() })
  void apply()
}
