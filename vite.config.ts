import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // Honor an externally assigned port (e.g. preview harnesses); vite's
    // default 5173 otherwise.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
  plugins: [
    react(),
    // `vite --mode browser` runs the plain renderer with no Electron shell —
    // used for browser previews and UI work. Export/IPC features are inert.
    ...(mode === 'browser'
      ? []
      : [
          electron([
            {
              entry: 'electron/main.ts',
            },
            {
              entry: 'electron/preload.ts',
              onstart(args) {
                args.reload()
              },
              vite: {
                build: {
                  rollupOptions: {
                    output: {
                      entryFileNames: 'preload.mjs',
                    },
                  },
                },
              },
            },
          ]),
          renderer(),
        ]),
  ],
}))
