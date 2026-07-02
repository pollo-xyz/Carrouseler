# Changelog

## Since v0.3.0

This covers the changes implemented after the `v0.3.0` tag through the current `0.5.2` codebase, including the latest uncommitted seamless-slide fixes.

### Canvas and Editing

- Added rich text layers, including font family selection, bold/italic styling, color, alignment, line height, letter spacing, shadows, strokes, and optional text background pills.
- Added text fill mode, which automatically sizes and balances text to fit inside a chosen box.
- Added shape layers for rectangles, ellipses, and lines, with fill, stroke, sizing, and transform support.
- Added copy, cut, paste, undo, and redo support for editor content.
- Added multi-select behavior and clearer per-item selection outlines.
- Added support for "appears on all slides" master-style items so repeated graphics can show across every slide.
- Added layer stack controls for selecting and exporting individual slides.
- Added slide names, slide duplication, slide deletion, drag reordering, and per-slide export toggles.
- Added `[` and `]` shortcuts to move selected items between slides.
- Added a `NumberField` component for more precise numeric controls.

### Media Tools

- Added drag-and-drop support for GIF media.
- Added a Giphy picker with GIF and sticker tabs, trending results, debounced search, and `VITE_GIPHY_API_KEY` configuration.
- Added GIF downloading into the project so Giphy results are embedded as bytes instead of linked remotely.
- Added manual GIF animation via WebCodecs/ImageDecoder fallback logic so GIF playback stays reliable in the Konva canvas.
- Added beta background removal using `@imgly/background-removal`.
- Added image/video/GIF correction controls including crop, brightness, contrast, saturation, blur, and flipping.
- Added video trim controls and cover-frame support.
- Added support for custom video cover images.
- Added palette sampling from selected media.

### Backgrounds, Guides, and Layout

- Added the generative "Vibe" background system, with named palettes, custom saved palettes, blur, grain, point count, randomized size, randomized layering, and seed rerolling.
- Added per-slide and all-slide background editing modes.
- Added workspace/pasteboard background color control.
- Added adjustable grid opacity, center guides, hidden-zone display, margin/safe-area snapping, and Instagram safe-area overlays.
- Added seamless-slide mode for checking alignment across adjacent carousel slides.
- Fixed the faint background line that could appear between seamless slides by punching one continuous hidden-zone hole across the strip.
- Added editor-only dotted seam guides between seamless slides; they are hidden by Preview mode and excluded from export.
- Added Preview mode to hide editor-only chrome such as grids, safe-area overlays, warnings, and seamless dividers.
- Improved seamless background rendering so matching Vibe backgrounds can render as one continuous strip.

### Export

- Added one-click mixed export behavior: static slides export as PNG and video/GIF slides export as MP4.
- Added per-slide export from the editor/layer UI.
- Added drag-out slide export so slides can be dragged to Finder/Explorer, Slack, browsers, or other drop targets as PNGs.
- Added a canvas-pinned export status toast.
- Added an export veil so camera resets and capture changes are hidden during export.
- Added live export preview frames under the export veil.
- Changed export preview to show full-resolution captures so it reflects real output quality.
- Removed the older pre-export viewport snapshot once live preview covered the same need.
- Added playback-driven video export to replace slower per-frame seeking for normal video export paths.
- Added GIF-only video export support using GIF duration settings.
- Added source-video FPS detection with `requestVideoFrameCallback`.
- Added common-rate FPS rounding and mixed-FPS warnings.
- Fixed FPS snapping so a measured rate chooses the closest common rate rather than the first rate inside tolerance.
- Added runtime FFmpeg encoder probing and diagnostics.
- Added hardware encoder selection:
  - macOS: `h264_videotoolbox`, then `libx264`.
  - Windows/Linux: `h264_nvenc`, `h264_qsv`, `h264_amf`, then `libx264`.
- Improved export error visibility, progress reporting, and encoder readout.
- Added blob URL cleanup to reduce memory leaks during repeated media/project operations.

### Projects and Files

- Expanded the `.vpost` project format to persist newer editor state, including guide settings, workspace background color, last text style, backgrounds, GIF metadata, and slide export settings.
- Added embedded Fit-view `preview.png` generation inside saved `.vpost` project files.
- Tuned embedded project previews to a more reasonable maximum size.
- Added app/file icons and `.vpost` file association icons.
- Added double-click/open-with handling for `.vpost` files.
- Added recent project tracking and recent-file menus.
- Added save-on-quit prompting that waits for the renderer save to complete before closing.
- Improved project portability by embedding original asset bytes in saved project files.
- Renamed internal `Carousel*` identifiers and Affinity source naming to Tiovivo.

### App Shell and UX

- Added a real Tiovivo brand icon and branded file icon.
- Added an in-app menu bar for Windows/Linux while keeping the native menu pattern on macOS.
- Added custom title-bar behavior on Windows/Linux.
- Added a static-width export button to reduce layout shifting.
- Moved export status out of the header and onto the canvas.
- Added recent-file UI for non-macOS platforms.
- Updated app identity from `com.verso.tiovivo` to `com.tiovivo.app`.
- Updated README from the default Vite template into Tiovivo-specific product and development documentation.

### Build, Release, and CI

- Bumped the app from `0.3.0` to `0.5.2`.
- Added build artifacts for every push and release artifacts for tagged `v*` builds.
- Added unique CI build metadata using the GitHub Actions run number.
- Added macOS hardened runtime, entitlements, code signing, and notarization configuration.
- Added Windows NSIS installer configuration with Tiovivo branding.
- Added real app and file icons to packaged builds.
- Reduced packaged icon weight by using the smaller in-app icon where appropriate.
- Updated GitHub Actions build workflow for cross-platform macOS and Windows artifacts.
- Added `.gitignore` entries for local scratch files and generated outputs.

### Developer/Internal

- Replaced `useCarouselStore` with `useTiovivoStore`.
- Added helper libraries for Vibe backgrounds, system font listing, Giphy API access, GIF animation, background removal, media palette sampling, project previews, and video FPS detection.
- Added Electron preload types and IPC surface for project files, recents, encoder diagnostics, export, and drag-out behavior.
- Added `.claude/blur-source.js` and related local development configuration for the background generator work.

### Commit History Covered

- `556d830` - text layer, fill mode, copy/paste, encoder probe/perf, persistence, app icon.
- `dd13872` - save-on-quit prompt, macOS encoder parity, build-on-push CI.
- `2ad0abb` - mac code signing and notarization.
- `f339af4` - embedded Fit-view preview in `.vpost` projects.
- `0de9cb6` - tuned embedded project preview size.
- `d392013` - branded app and file-association icons.
- `85bb225` - bumped to `0.5.0` and tagged CI artifacts with build numbers.
- `12eaf8e` - export error visibility, encoder readout, smoother progress, blob URL cleanup.
- `7232025` - playback-driven video export.
- `07cf69c` - source video FPS detection and mixed-FPS warnings.
- `6d27821` - closest-rate FPS snapping fix.
- `0eeb5ef` - brand icon, static-width export button, recent files.
- `1356ec1` - in-app menu bar and custom title bar on Windows/Linux.
- `614c2ef` - smaller in-app icon asset.
- `31cafae` - canvas-pinned export status toast.
- `525bb17` - export veil during capture.
- `4609a17` - live frame preview under the export veil.
- `fda16e8` - version bump to `0.5.1`.
- `57dc1b3` - full-resolution export preview.
- `fbb7b71` - removed redundant pre-export viewport snapshot.
- `6ef1d20` - internal Tiovivo rename cleanup.
- `230a01e` - scratch commit-message ignore rule.
- `b343c33` - bundle ID changed to `com.tiovivo.app`.
- `7982db3` - blur/Vibe generator and UI updates.
- `26f66d7` - drag-out export, font picker, GIF picker, background removal.

