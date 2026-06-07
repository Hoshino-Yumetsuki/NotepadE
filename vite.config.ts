import { resolve } from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

/**
 * Native Vite + Electron build (replaces electron-vite) for the 3-tier process
 * model (docs/plan/00-overview.md §1):
 *   - main     -> out/main/index.js     (ESM; Node/Electron; fs/dialog/encoding)
 *   - preload  -> out/preload/index.js  (CJS — sandboxed preloads must be CJS)
 *   - renderer -> out/renderer/         (React + Fluent v9 + CM6; no Node built-ins)
 *
 * `vite` runs the renderer dev server, (re)builds main/preload, and launches
 * Electron (vite-plugin-electron sets process.env.VITE_DEV_SERVER_URL, which the
 * main process reads in src/main/index.ts). `vite build` emits the production
 * bundles. The out/main|preload|renderer sibling layout is load-bearing: main
 * resolves ../preload/index.js and ../renderer/index.html relative to out/main.
 * The E2E driver (e2e/helpers/launch.ts) probes out/main/index.js first.
 */
const dirname = import.meta.dirname;
const require = createRequire(import.meta.url);
const pkg = require('./package.json') as {
  dependencies?: Record<string, string>;
  version?: string;
};

/**
 * Externalize Electron, Node built-ins, and every runtime dependency from the
 * main/preload bundles (replaces electron-vite's externalizeDepsPlugin) so native
 * modules like koffi and CJS deps like iconv-lite/jschardet resolve from
 * node_modules at runtime instead of being bundled.
 */
const nodeExternals = [
  'electron',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  ...Object.keys(pkg.dependencies ?? {}),
];

export default defineConfig(({ command }) => ({
  root: resolve(dirname, 'src/renderer'),
  // Relative base so the production build's asset URLs work under file://.
  base: './',
  // Inline the real package version at build time so the About pane shows it
  // (UWP surfaced Package.Current.Id.Version). No IPC needed — pure build constant.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
  },
  resolve: {
    alias: {
      '@shared': resolve(dirname, 'src/shared'),
    },
  },
  build: {
    outDir: resolve(dirname, 'out/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(dirname, 'src/renderer/index.html'),
    },
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
          },
        }
      : null,
    electron({
      main: {
        entry: resolve(dirname, 'src/main/index.ts'),
        // The dev launcher otherwise runs `electron .` with cwd = vite root
        // (src/renderer), so Electron looks for the app there and fails with
        // "Cannot find module .../src/renderer". Launch the built main by its
        // absolute path instead (cwd-independent), mirroring the e2e launcher.
        // NOTE: no --no-sandbox — the vite-plugin-electron starter ships it, but
        // it contradicts webPreferences.sandbox:true and weakens the dev runtime
        // for no reason. Removing it keeps dev's process model identical to prod.
        onstart: (args) => {
          void args.startup([resolve(dirname, 'out/main/index.js')]);
        },
        vite: {
          build: {
            outDir: resolve(dirname, 'out/main'),
            rollupOptions: {
              external: nodeExternals,
              output: { format: 'es', entryFileNames: 'index.js' },
            },
          },
        },
      },
      preload: {
        input: resolve(dirname, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: resolve(dirname, 'out/preload'),
            rollupOptions: {
              external: nodeExternals,
              // Sandboxed preloads (sandbox:true) MUST be CommonJS.
              output: { format: 'cjs', entryFileNames: 'index.js' },
            },
          },
        },
      },
    }),
  ],
}));
