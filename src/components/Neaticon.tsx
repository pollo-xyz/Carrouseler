import React from 'react'

/**
 * NeatIcons Pro glyphs (same licensed set as toqe) — clean-named SVGs in
 * resources/neaticons/ (linear = resting) and resources/neaticons-bold/
 * (bold = active/selected, where the library ships one). Inlined so every
 * glyph follows currentColor across Onyx and Cream.
 */
const RESTING = import.meta.glob('../../resources/neaticons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const BOLD = import.meta.glob('../../resources/neaticons-bold/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function keyOf(path: string): string {
  return path.split('/').pop()!.replace(/\.svg$/, '')
}

// Strip the outer <svg> wrapper, recolor the library navy to currentColor
// (both cases seen in the wild), and drop stray ids so duplicated glyphs
// can never collide.
function inner(svg: string): string {
  return svg
    .replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
    .replace(/#13193[aA]/g, 'currentColor')
    .replace(/\s+id="[^"]*"/g, '')
    .trim()
}

function build(glob: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [path, svg] of Object.entries(glob)) out[keyOf(path)] = inner(svg)
  return out
}
const GLYPHS = build(RESTING)
const BOLD_GLYPHS = build(BOLD)

export interface NeaticonProps extends React.SVGProps<SVGSVGElement> {
  name: string
  /** Heavier cut for active/selected states, when the library ships one. */
  bold?: boolean
  title?: string
}

export function Neaticon({ name, bold = false, className = '', title, ...props }: NeaticonProps) {
  const boldGlyph = BOLD_GLYPHS[name]
  const glyph = bold && boldGlyph ? boldGlyph : GLYPHS[name] || boldGlyph
  if (!glyph) return null
  return (
    <svg
      className={`neaticon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      dangerouslySetInnerHTML={{ __html: glyph }}
      {...props}
    />
  )
}
