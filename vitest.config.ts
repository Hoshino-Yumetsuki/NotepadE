import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest config for renderer-side unit/component tests (Lane D harness).
 *
 * Bare `vitest` cannot resolve the `@shared/*` alias the renderer uses, nor does
 * it render React components without a DOM. This config supplies both:
 *   - `@shared` alias  -> src/shared  (matches electron.vite.config.ts + tsconfig.web.json)
 *   - jsdom environment -> Testing Library can mount Fluent/React components
 *
 * Scope is intentionally limited to renderer + shared sources. Main-process code
 * (fs/encoding) is exercised by the e2e round-trip, not vitest.
 *
 * NOTE: this config does NOT widen the PA-8 surface — tests live under src/ and
 * compose only the renderer's public seams + window.notepads contract types.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Co-located renderer/shared specs. e2e/** is Playwright-only — exclude it so
    // `vitest run` never tries to execute Playwright's `test()` from @playwright/test.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'out', 'dist', 'e2e/**']
  }
});
