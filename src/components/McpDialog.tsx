import { useEffect, useRef, useState } from 'react'
import type { McpStatus } from '../electron'
import { toast } from '../lib/feedback'

/** File → Connect Claude: switch the built-in MCP server on and hand over
 *  the one command that registers it with Claude Code. */
export default function McpDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const api = window.electronAPI

  useEffect(() => {
    void api?.mcpGetStatus?.().then(setStatus)
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { if (prev?.isConnected) prev.focus() }
  }, [api])

  const command = status
    ? `claude mcp add --transport http --scope user tiovivo ${status.url} --header "Authorization: Bearer ${status.token}"`
    : ''

  const copy = async () => {
    try {
      if (!(await api?.mcpCopyCommand?.(command))) throw new Error('copy refused')
      toast('Command copied. Run it once in a terminal.', { kind: 'success' })
    } catch {
      toast('Could not copy — select the command and copy it by hand.', { kind: 'error' })
    }
  }

  return (
    <div
      className="confirm__backdrop"
      onKeyDown={(e) => {
        // Modal: keep keystrokes away from the canvas shortcuts behind it.
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="confirm mcp" role="dialog" aria-modal="true" aria-label="Connect Claude">
        <div className="confirm__title">Connect Claude</div>
        {!api?.mcpGetStatus ? (
          <p className="mcp__note">Connecting Claude works in the desktop app, not the browser.</p>
        ) : !status ? (
          <p className="mcp__note">Loading…</p>
        ) : (
          <>
            <p className="mcp__note">
              Let Claude build and edit slides in this window. You watch each change land and can undo any of it.
            </p>
            <label className="check mcp__switch">
              <input
                type="checkbox"
                checked={status.enabled}
                onChange={(e) => { void api.mcpSetEnabled(e.target.checked).then(setStatus) }}
              />
              Allow Claude to control Tiovivo
            </label>
            {status.error ? (
              <p className="mcp__state mcp__state--error">{status.error}</p>
            ) : (
              <p className="mcp__state">
                {status.running ? `Listening on this computer only · ${status.url}` : 'Off'}
              </p>
            )}

            <div className="mcp__label">Run once in a terminal</div>
            <div className="mcp__command">
              <code>{command}</code>
              <button type="button" className="btn btn--sm" onClick={() => { void copy() }}>Copy</button>
            </div>
            <p className="mcp__hint">
              The command contains a private key. Anyone who has it can control this app while it is open.{' '}
              <button
                type="button"
                className="mcp__link"
                onClick={() => { void api.mcpNewToken().then(setStatus) }}
                title="Old commands stop working; run the new one"
              >
                Make a new key
              </button>
            </p>

            <div className="mcp__label">Projects and exports go to</div>
            <div className="mcp__command">
              <code title={status.outputDir}>{status.outputDir}</code>
              <button type="button" className="btn btn--sm" onClick={() => { void api.mcpPickOutputDir().then(setStatus) }}>
                Change…
              </button>
            </div>
          </>
        )}
        <div className="confirm__actions">
          <button ref={closeRef} className="confirm__btn confirm__btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
