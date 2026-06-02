import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * electron-vite build config for the 3-tier process model
 * (docs/plan/00-overview.md §1):
 *   - main    -> out/main/index.js     (Node/Electron; owns fs/dialog/path/encoding)
 *   - preload -> out/preload/index.js  (contextBridge; sole window.notepads surface)
 *   - renderer-> out/renderer/         (React 18 + Fluent v9 + CM6; no Node built-ins)
 *
 * The E2E driver (e2e/helpers/launch.ts) probes out/main/index.js first, so the
 * main entry MUST land there.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads (sandbox:true) MUST be CommonJS. Force a .js (cjs)
        // entry so the preload path in window-factory (../preload/index.js) loads.
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
