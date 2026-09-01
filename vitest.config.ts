import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest config for renderer and shared unit/component tests.
 *
 * Supplies the `@shared` alias and jsdom so Testing Library can mount
 * Fluent/React components. Backend code has co-located Rust tests.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    server: {
      deps: {
        // Fluent's published ESM uses extensionless internal imports; Vite resolves
        // them when transformed, while Node's strict ESM loader rejects them.
        inline: [/@fluentui\/react-/]
      }
    },
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'out', 'dist']
  }
});
