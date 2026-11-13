export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  outputDir: string
  error: string | null
}

export interface AiStatus {
  source: 'saved' | 'environment' | null
  canSave: boolean
}

export interface AiRunResult {
  ok: boolean
  result?: unknown
  error?: string
  cancelled?: boolean
}

export interface McpCall {
  id: string
  tool: string
  args: Record<string, unknown>
  mutates: boolean
}

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
  /** Recents with last-saved time and the preview embedded in each file. */
  getRecentDetails: () => Promise<{ path: string; modified: number; preview: Uint8Array | null }[]>
  openRecent: (filePath: string) => Promise<void>
  clearRecents: () => Promise<void>

  windowMinimize: () => Promise<void>
  windowMaximizeToggle: () => Promise<void>
  windowClose: () => Promise<void>
  setTitleOverlay: (colors: { color: string; symbolColor: string }) => Promise<void>

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
  }) => Promise<{ ok: boolean; encoder: string }>

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

  /** Abandon an encoding session: kills ffmpeg, deletes the partial file. */
  abortVideoEncode: (options: {
    sessionId: string
  }) => Promise<void>

  /** Toggle Chromium DevTools for this window. */
  toggleDevTools: () => Promise<void>

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

  /** In-app assistant. */
  aiStatus: () => Promise<AiStatus>
  aiSetKey: (key: string) => Promise<AiStatus>
  aiClearKey: () => Promise<AiStatus>
  aiRun: (req: { runId: string; task: string; params?: Record<string, unknown> }) => Promise<AiRunResult>
  aiCancel: (runId: string) => Promise<void>
  /** Native picker; returns the chosen image paths. */
  aiPickImages: () => Promise<string[]>
  onAiProgress: (cb: (p: { runId: string; line: string }) => void) => () => void
  copyText: (text: string) => Promise<boolean>

  /** Built-in MCP server (File → Connect Claude). */
  mcpGetStatus: () => Promise<McpStatus>
  mcpSetEnabled: (enabled: boolean) => Promise<McpStatus>
  mcpNewToken: () => Promise<McpStatus>
  /** Put the registration command on the system clipboard. */
  mcpCopyCommand: (text: string) => Promise<boolean>
  mcpPickOutputDir: () => Promise<McpStatus>
  onMcpCall: (cb: (call: McpCall) => void) => () => void
  sendMcpResult: (msg: { id: string; ok: boolean; result?: unknown; error?: string }) => void
  onOpenMcp: (cb: () => void) => () => void

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
