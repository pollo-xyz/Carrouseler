/* Tool catalogue for the built-in MCP server (see mcp.ts). The schemas are
 * what the connected agent reads; the implementations live in the renderer
 * (src/lib/mcpBridge.ts) because they act on the live document. */

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Changes the document — refused while an export is running. */
  mutates?: boolean
}

const SLIDE_REF = {
  description: 'Slide number (1-based) or slide id. Omit for the active slide.',
  type: ['integer', 'string'],
}

const ITEM_FIELDS: Record<string, unknown> = {
  x: { type: 'number', description: 'Left edge in slide px (origin top-left).' },
  y: { type: 'number', description: 'Top edge in slide px.' },
  width: { type: 'number' },
  height: { type: 'number', description: 'Text: measured automatically unless fillMode is on.' },
  rotation: { type: 'number', description: 'Degrees.' },
  name: { type: 'string', description: 'Layer name.' },
  appearsOnAllSlides: { type: 'boolean', description: 'Repeat this item on every slide (logo, handle, page furniture).' },
  animIn: { enum: ['none', 'fade', 'rise', 'pop'], description: "Entrance animation. Plays in the one-video export (as: 'video') and in the looping video of a slide that has moving effects." },
  effects: { type: 'object', description: "Motion and light the layer carries itself, so a slide moves without a baked video. An object keyed by effect; each value is its settings, true for defaults, or null to remove it. On update_items the kinds you give replace those kinds and the rest stay. Kinds: glow (steady halo; breathe: true makes it swell and fade), pulse (a brief swell), drift (slow float; angle 90 = up/down, 0 = sideways), shimmer (a band of light sweeping across the layer's own shape), flash (hidden except for a short spell: fades in, holds about 1.6s, fades out — for callout rings that come and go), highlight (text: lights the accent words one after another), reveal (text: each paragraph comes up from dim in order), travel (pointer shapes: glides in from dx, dy and clicks). Settings, all optional: speed (multiplier, default 1), strength (0–1), delay (seconds into the slide; offset layers to run them in sequence), every (seconds between repeats for pulse, shimmer, flash, travel; 0 = once per loop), color (glow, shimmer), angle (drift), breathe (glow), dx / dy (travel start offset in px). Example: { \"glow\": { \"strength\": 0.6, \"breathe\": true }, \"shimmer\": { \"every\": 3 } }. Anything but a steady glow makes the slide export as a looping MP4 instead of a PNG; stills show the layer at rest." },
  animDelay: { type: 'number', description: 'Seconds after its slide appears before the entrance starts. Stagger items (0, 0.4, 0.8 …) to reveal them in reading order.' },

  text: { type: 'string', description: 'Text content; \\n for line breaks. With accentColor set, words wrapped in *asterisks* are drawn in that colour.' },
  accentColor: { type: 'string', description: 'CSS hex colour for words marked *like this* in the text. Use it for one emphasised word or phrase instead of a second text box.' },
  fontFamily: { type: 'string', description: 'An installed font family — see list_fonts.' },
  fontSize: { type: 'number', description: 'px in slide space.' },
  bold: { type: 'boolean' },
  italic: { type: 'boolean' },
  textColor: { type: 'string', description: 'CSS hex colour.' },
  textAlign: { enum: ['left', 'center', 'right', 'justify'] },
  lineHeight: { type: 'number', description: 'Multiplier, e.g. 1.1.' },
  letterSpacing: { type: 'number', description: 'px.' },
  fillMode: { type: 'boolean', description: 'Scale the font so the text fills its width × height box.' },
  shadowEnabled: { type: 'boolean' },
  shadowColor: { type: 'string' },
  shadowBlur: { type: 'number' },
  shadowOffsetX: { type: 'number' },
  shadowOffsetY: { type: 'number' },
  shadowOpacity: { type: 'number', description: '0–1.' },
  textBgColor: { type: 'string', description: 'Highlight pill behind the text.' },
  textBgPadding: { type: 'number' },
  textBgCornerRadius: { type: 'number' },
  textBgOpacity: { type: 'number', description: '0–1.' },

  shapeKind: { enum: ['rect', 'ellipse', 'line', 'cursor'], description: "'cursor' is a mouse pointer whose tip is at x, y (about 64×64); give it the travel effect to glide in and click." },
  fillColor: { type: 'string', description: "CSS hex colour or 'transparent'." },
  strokeColor: { type: 'string' },
  strokeWidth: { type: 'number' },
  cornerRadius: { type: 'number', description: 'Rectangles only.' },

  opacity: { type: 'number', description: 'Media only, 0–1.' },
  brightness: { type: 'number', description: 'Media only, -1 to 1.' },
  contrast: { type: 'number', description: 'Media only, -100 to 100.' },
  saturation: { type: 'number', description: 'Media only, 0–2 (1 = unchanged).' },
  blur: { type: 'number', description: 'Media only, px radius 0–200.' },
  flipX: { type: 'boolean' },
  flipY: { type: 'boolean' },
}

const NEW_ITEM = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { enum: ['text', 'shape', 'image'], description: "'image' also takes videos and GIFs." },
    path: { type: 'string', description: 'image only: absolute path of a local image / video / GIF file.' },
    fit: {
      enum: ['cover', 'contain', 'none'],
      description: "image only: 'cover' fills the slide (cropping overflow), 'contain' fits inside it, 'none' keeps natural size. Default 'contain' when no width/height is given.",
    },
    ...ITEM_FIELDS,
  },
}

const NEW_ITEMS = {
  type: 'array',
  items: NEW_ITEM,
  description: 'Items in z-order, bottom first.',
}

const VIBE = {
  description: 'Generative blurred-gradient background. null removes it.',
  type: ['object', 'null'],
  properties: {
    palette: {
      description: '2–8 hex colours (first is the base wash), or a named palette (see get_project → vibePalettes).',
      type: ['array', 'string'],
      items: { type: 'string' },
    },
    pointCount: { type: 'integer', minimum: 3, maximum: 8 },
    blur: { type: 'number', minimum: 0, maximum: 200 },
    grain: { type: 'number', minimum: 0, maximum: 1 },
    size: { type: 'number' },
    seed: { type: 'integer', description: 'Fix the composition; omit for a fresh one.' },
  },
}

export const TOOLS: McpToolDef[] = [
  {
    name: 'get_project',
    description:
      'Read the open Tiovivo document: format, slides and every item with its measured box. Call this first, and again after adding text when you need real text heights for layout.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'new_project',
    mutates: true,
    description:
      'Start an empty document. Refuses when the open document has unsaved changes unless discard_unsaved is true — prefer save_project first.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { enum: ['1:1', '4:5', '3:4', '9:16', 'hd'], description: '4:5 = 1080×1350 feed post, 3:4 = 1080×1440, 9:16 = 1080×1920 Reels/TikTok/Stories, hd = 1920×1080.' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        discard_unsaved: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_format',
    mutates: true,
    description: 'Change the slide size for the whole document: a preset, or custom width + height in px.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { enum: ['1:1', '4:5', '3:4', '9:16', 'hd'] },
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
  },
  {
    name: 'add_slide',
    mutates: true,
    description: 'Add a slide, optionally with its background and items in one call. Returns the slide and its items.',
    inputSchema: {
      type: 'object',
      properties: {
        after: { ...SLIDE_REF, description: 'Insert after this slide (number or id). Default: at the end.' },
        name: { type: 'string' },
        seconds: { type: ['number', 'null'], description: 'How long the slide holds in a one-video export. null = automatic.' },
        bgColor: { type: 'string', description: 'CSS hex colour.' },
        vibe: VIBE,
        items: NEW_ITEMS,
      },
    },
  },
  {
    name: 'update_slide',
    mutates: true,
    description: 'Change a slide: name, background, export flag, or position in the deck.',
    inputSchema: {
      type: 'object',
      properties: {
        slide: SLIDE_REF,
        name: { type: 'string' },
        seconds: { type: ['number', 'null'], description: 'How long the slide holds in a one-video export. null = automatic.' },
        bgColor: { type: 'string', description: 'Solid colour; also removes any vibe background.' },
        vibe: VIBE,
        exportEnabled: { type: 'boolean' },
        position: { type: 'integer', description: 'Move the slide to this 1-based position.' },
      },
    },
  },
  {
    name: 'duplicate_slide',
    mutates: true,
    description: 'Duplicate a slide with all its items, right after the original.',
    inputSchema: { type: 'object', properties: { slide: SLIDE_REF } },
  },
  {
    name: 'remove_slide',
    mutates: true,
    description: 'Delete a slide and its items (the last remaining slide cannot be removed).',
    inputSchema: { type: 'object', required: ['slide'], properties: { slide: SLIDE_REF } },
  },
  {
    name: 'add_items',
    mutates: true,
    description: 'Add text, shapes and images to a slide. Returns the created items with their measured boxes.',
    inputSchema: {
      type: 'object',
      required: ['items'],
      properties: { slide: SLIDE_REF, items: NEW_ITEMS },
    },
  },
  {
    name: 'update_items',
    mutates: true,
    description: 'Patch existing items by id — any item field, plus `slide` to move an item to another slide. One undo step.',
    inputSchema: {
      type: 'object',
      required: ['updates'],
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'string' }, slide: SLIDE_REF, ...ITEM_FIELDS },
          },
        },
      },
    },
  },
  {
    name: 'remove_items',
    mutates: true,
    description: 'Delete items by id.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: { ids: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'reorder_layers',
    mutates: true,
    description: "Set the z-order of a slide's items: every item id on that slide, bottom first.",
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: { slide: SLIDE_REF, ids: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'render',
    description:
      'Look at the result. With `slide`: that slide exactly as it will export. Without: a contact sheet of the whole deck. Use it after building to check hierarchy, overflow and contrast.',
    inputSchema: {
      type: 'object',
      properties: {
        slide: SLIDE_REF,
        max_size: { type: 'integer', description: 'Longest edge of the returned image in px (default 1024, max 2048).' },
      },
    },
  },
  {
    name: 'export',
    description:
      "Export every export-enabled slide into a folder inside Tiovivo's output folder. as: 'slides' (default) = PNG per still slide, MP4 per slide with video or GIFs; 'photos' = a JPEG of every slide (TikTok photo mode); 'video' = all slides in order as one MP4 with entrance animations (Reels, TikTok). Returns the file paths.",
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name to create (default: the file prefix plus a timestamp).' },
        prefix: { type: 'string', description: "File name prefix, e.g. 'launch' → launch_01.png." },
        as: { enum: ['slides', 'photos', 'video'] },
        transition: { enum: ['cut', 'fade', 'push'], description: "Between slides, for as: 'video'. Default fade." },
      },
    },
  },
  {
    name: 'save_project',
    description:
      "Save the document as a .vpost project. With `name`: saved under that name in Tiovivo's output folder. Without: re-saved where it already lives.",
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  },
  {
    name: 'list_fonts',
    description: 'Font families installed on this machine, usable as fontFamily.',
    inputSchema: {
      type: 'object',
      properties: { filter: { type: 'string', description: 'Case-insensitive substring.' } },
    },
  },
  {
    name: 'undo',
    mutates: true,
    description: 'Undo the last edit(s).',
    inputSchema: {
      type: 'object',
      properties: { steps: { type: 'integer', minimum: 1, maximum: 50 } },
    },
  },
]

export const INSTRUCTIONS = `Tiovivo is a desktop editor for social carousels and short-form posts. These tools act on the document that is open in the app right now — the person can watch every change land and undo it.

get_project also returns the person's brand kit (fonts, background, text and accent colours, handle). Use it for new content unless they ask for something else.

Working method: get_project → set the format → build slide by slide with add_slide (pass the items in the same call) → render to look at what you made → fix with update_items → export or save_project.

Coordinates are slide pixels from the top-left. Feed posts are 1080×1350 (4:5) or 1080×1440 (3:4); Reels, TikTok and Stories are 1080×1920 (9:16). Keep text at least 80px from the edges. On 9:16 leave the top ~250px and bottom ~420px free of anything important, since the apps draw their own interface there. Carousel slides are swiped left to right, so slide 1 is the hook.

Text boxes take x, y and width; the height is measured by the app (read it back with get_project). Use fillMode to make a headline fill a box exactly. Images come from local file paths.

For movement, give layers \`effects\` rather than reaching for video: keep words as live text and shapes as shapes so the person can still edit them. Use effects sparingly — one or two moving things per slide — and stagger related layers with \`delay\`.`
