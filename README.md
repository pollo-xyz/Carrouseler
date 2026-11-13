<div align="center">

<img src="resources/tiovivo_appicon_small.png" alt="Tiovivo" width="128" height="128" />

# Tiovivo

**A multi-slide carousel designer for Instagram-style posts and short video sequences.**

Drop in images and videos, arrange them across slides, tune crops and filters, drop in text — then export the whole carousel as PNGs and hardware-encoded MP4s in one pass.

[![Platform](https://img.shields.io/badge/macOS-arm64%20%7C%20x64-000?logo=apple&logoColor=white)](https://github.com/)
[![Platform](https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white)](https://github.com/)
[![Electron](https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Konva](https://img.shields.io/badge/Konva-10-0D83CD)](https://konvajs.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-static-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

<img src="docs/screenshots/editor-overview.png" alt="Tiovivo editor showing a portrait carousel artboard, slide controls, and export tools" width="880" />

The desktop editor for building multi-slide social posts with static images, text, GIFs, and video.

</div>

---

## Product tour

Tiovivo keeps the full carousel in view while still giving each slide its own export controls, background settings, layer stack, and design guides.

![Text editing controls with the selected text box on the canvas](docs/screenshots/text-tools.png)

**Text and layer editing:** add text, style it, align it, resize it, and manage selected items directly from the side panel and floating canvas toolbar.

![Two seamless slides with grid, center guides, and seam markers visible](docs/screenshots/guides-seamless.png)

**Guides for layout:** toggle seamless mode, grid, center guides, hidden-zone masking, snap controls, and Instagram safe-area overlays while composing.

![Preview mode showing the same two-slide carousel with guide overlays hidden](docs/screenshots/preview-mode.png)

**Preview mode:** hide editor-only guides, seams, warnings, and safe areas so the canvas matches what final exports should include.

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🖼️ &nbsp;Canvas editor

- Konva-powered editor for unlimited slides per project
- Drag-and-drop images, videos, GIFs straight onto the canvas
- Rich text layers with system-font enumeration, bold / italic, color, line-height and letter-spacing
- Fill-mode text that auto-fits a box as you type
- Per-image **crop, brightness, contrast, saturation, blur, flip**
- Per-video **trim** + **cover-frame** selection

</td>
<td width="50%" valign="top">

### 🎯 &nbsp;Layout & snap

- Format presets — **HD 16:9**, **1:1**, **4:5**, **3:4**, or **Custom** (64 – 8192 px)
- Snap to **grid**, **center**, **other items**, and **safe-area margins**
- Optional grid overlay with adjustable opacity
- Center guides + hidden-zone safe area
- Seamless-slide preview to check edge alignment across the carousel
- Per-slide and global background colors, plus pasteboard color

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🚀 &nbsp;Hardware-accelerated export

- One-click **Export all** — PNG for static slides, MP4 for video slides
- Per-slide export from the layer stack
- Auto-detects source FPS via `requestVideoFrameCallback`, picks the most common rate, warns on mixed sources
- Encoder probe at runtime:
  - **macOS:** `h264_videotoolbox`
  - **Windows / Linux:** `h264_nvenc` → `h264_qsv` → `h264_amf`
  - Always falls back to `libx264`
- Live downscaled preview frame under the export veil so you can see real progress

</td>
<td width="50%" valign="top">

### 💾 &nbsp;Projects & UX

- `.vpost` project format — a ZIP bundle with manifest + original asset bytes + embedded Fit-view preview
- macOS native menu bar with file associations; in-app menu bar on Windows / Linux
- Start screen: blank formats, starter structures (list, how-to, myth / fact, quote, announcement, reel cover) and recent projects with previews
- Brand kit — your fonts, three colours and handle; templates are drawn in it, colour fields offer it, and *Apply to this deck* restyles a whole document in one undo step
- Recent projects list (per-platform)
- Save-on-quit prompt that actually waits for the save to succeed
- Undo / redo, copy / cut / paste, `[` / `]` to move items between slides
- Drag-reorder slides; duplicate / delete slides
- Code-signed and notarized macOS builds via GitHub Actions

</td>
</tr>
</table>

---

## 🤖 Connect Claude (MCP)

The desktop app has a built-in [MCP](https://modelcontextprotocol.io) server, so an agent such as Claude Code can build and edit slides in the open window while you watch.

1. **File → Connect Claude…**, switch on *Allow Claude to control Tiovivo*.
2. Copy the command from the dialog and run it once in a terminal. It registers the server with Claude Code.
3. Keep Tiovivo open and ask Claude for what you want, e.g. *"make a 6-slide carousel about X in Tiovivo and export it"*.

Tools: `get_project`, `new_project`, `set_format`, `add_slide`, `update_slide`, `duplicate_slide`, `remove_slide`, `add_items`, `update_items`, `remove_items`, `reorder_layers`, `render` (returns an image of a slide or the whole deck), `export`, `save_project`, `list_fonts`, `undo`.

The server is off by default, listens on `127.0.0.1` only, requires the key shown in the dialog, and refuses requests from web pages. Projects and exports made through it land in the folder shown in the dialog (default `Documents/Tiovivo`). Every change goes through the normal undo history.

---

## 📐 Format presets

| Preset       | Dimensions   | Aspect | Common use                        |
| ------------ | ------------ | ------ | --------------------------------- |
| **HD 16:9**  | 1920 × 1080  | 16 : 9 | Landscape video / reels cover     |
| **1 : 1**    | 1080 × 1080  | 1 : 1  | Square IG / LinkedIn post         |
| **4 : 5**    | 1080 × 1350  | 4 : 5  | Portrait IG feed post             |
| **3 : 4**    | 1080 × 1440  | 3 : 4  | Pinterest / tall feed             |
| **Custom**   | 64 – 8192 px | any    | Anything else                     |

---

## 📦 `.vpost` project file

Tiovivo projects are stored as a single `.vpost` file, which is a ZIP bundle containing:

- A JSON **manifest** with slides, items, dimensions, guide settings, and last-used text style
- The **original asset bytes** for every placed image and video — projects are fully portable, no broken links
- An embedded **preview PNG** rendered from the Fit-view of all slides side-by-side, used by the OS file inspector

The file type is associated with the app on install — double-clicking a `.vpost` file opens it in Tiovivo.

<img src="resources/tiovivo_fileicon.png" alt=".vpost file icon" width="96" />

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run the renderer in the browser (no Electron, no export)
npm run dev

# Run as an Electron app
npm run dev   # then launch electron/main.ts via your runner of choice
```

### Build a desktop installer

```bash
npm run dist
```

Produces, in `release/`:

- macOS: `.dmg` and `.zip` for both `arm64` and `x64`
- Windows: NSIS `.exe` installer for `x64`

CI builds (see [.github/workflows/build.yml](.github/workflows/build.yml)) attach artifacts to every push and draft a GitHub Release for tagged `v*` builds. macOS code-signing and notarization run automatically when the required secrets are configured.

### Keyboard shortcuts

| Action                       | Shortcut              |
| ---------------------------- | --------------------- |
| New project                  | `⌘ / Ctrl + N`        |
| Open project                 | `⌘ / Ctrl + O`        |
| Save / Save as               | `⌘ / Ctrl + S` / `⇧S` |
| Undo / Redo                  | `⌘ / Ctrl + Z` / `Y`  |
| Copy / Cut / Paste           | `⌘ / Ctrl + C / X / V`|
| Delete selected              | `Delete` / `Backspace`|
| Move item to prev / next slide | `[` / `]`           |

---

## 🧱 Tech stack

- **[Electron](https://www.electronjs.org/) 41** — desktop shell, native menus, file associations
- **[React](https://react.dev/) 19** + **[TypeScript](https://www.typescriptlang.org/) 5.9** — renderer UI
- **[Vite](https://vite.dev/) 8** + `vite-plugin-electron` — dev server and bundler
- **[Konva](https://konvajs.org/) 10** + `react-konva` — canvas scene graph and transformer handles
- **[Zustand](https://github.com/pmndrs/zustand) 5** — store with hand-rolled undo / redo snapshots
- **[@dnd-kit](https://dndkit.com/)** — slide-thumbnail drag-reorder
- **[ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)** — bundled FFmpeg binary, used for hardware-accelerated H.264 export with a runtime encoder probe

---

## 📂 Project layout

```
tiovivo/
├── electron/
│   ├── main.ts          # window, menus, FFmpeg encoder probe, IPC
│   └── preload.ts       # contextBridge surface
├── src/
│   ├── App.tsx          # top-level shell, export orchestration, shortcuts
│   ├── components/
│   │   ├── EditorStage.tsx    # Konva stage, transforms, crop, filters, video, text
│   │   ├── LayerStack.tsx     # per-slide layer list
│   │   ├── SlideStrip.tsx     # draggable slide thumbnails
│   │   ├── MenuBar.tsx        # in-app menu bar (Windows / Linux)
│   │   └── NumberField.tsx
│   ├── lib/
│   │   ├── projectFile.ts     # .vpost serialize / deserialize
│   │   ├── zip.ts             # tiny in-house ZIP reader / writer
│   │   ├── thumbnail.ts       # Fit-view preview generator
│   │   ├── snapping.ts        # grid / center / item / margin snap math
│   │   ├── detectVideoFps.ts  # rVFC-based FPS detection
│   │   ├── presets.ts         # format presets
│   │   ├── fonts.ts           # queryLocalFonts + fallbacks
│   │   └── videoRegistry.ts
│   └── store/
│       └── useTiovivoStore.ts # Zustand store with undo / redo
├── resources/                 # app + file icons
├── public/                    # favicon, inline SVG icons
└── .github/workflows/build.yml
```

---

<div align="center">
<sub>Made with <a href="https://www.electronjs.org/">Electron</a> · <a href="https://react.dev/">React</a> · <a href="https://konvajs.org/">Konva</a> · <a href="https://ffmpeg.org/">FFmpeg</a></sub>
</div>
