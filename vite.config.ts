import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite build for the renderer (React + Fluent v9 + CM6).
 * The Tauri Rust binary serves the built renderer at runtime.
 *
 * `yarn tauri dev` runs the renderer dev server and launches the Tauri app.
 * `yarn build` (vite build) produces out/renderer/ for the Tauri bundler.
 * `yarn tauri build` compiles Rust and bundles the full desktop app.
 */
const dirname = import.meta.dirname;

export default defineConfig(({ command }) => ({
  root: resolve(dirname, 'src/renderer'),
  // Relative base so the production build's asset URLs work under file://.
  base: './',
  // Inline the real package version at build time so the About pane shows it.
  // No IPC needed — pure build constant.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0')
  },
  // Tauri uses TAURI_* env vars for platform detection, family, etc.
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      '@shared': resolve(dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(dirname, 'src/renderer/index.html')
      // NOTE: no manualChunks. Splitting the critical-path vendor groups
      // (react/fluentui/codemirror/dnd) into separate chunks was measured to
      // REGRESS cold start by ~850ms — under file:// in a single-window app
      // there is no cross-page cache benefit, only an ESM chunk-load/parse
      // waterfall. Code that is genuinely off the first-paint path (markdown,
      // diff, settings panes) is already deferred via React.lazy in App.tsx,
      // and the 28 non-default locales are dynamic chunks (i18n/locales).
    }
  },
  plugins: [
    react(),
    // Dev only: drop the strict CSP meta so Vite's react-refresh inline preamble
    // + HMR websocket work. The production build keeps the strict CSP in the HTML.
    command === 'serve'
      ? {
          name: 'notepads-dev-csp',
          apply: 'serve' as const,
          transformIndexHtml(html: string): string {
            return html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?\/>\s*/, '');
          }
        }
      : null
  ]
}));
