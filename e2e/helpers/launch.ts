import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolve the built Electron main entry. The scaffold (task #1) is expected to
 * emit the compiled main process to one of these locations. We probe in order
 * so this helper survives whichever build layout the scaffold settles on
 * (electron-vite -> out/main, tsc -> dist/main).
 */
function resolveMainEntry(): string {
  const candidates = [
    join(process.cwd(), 'out', 'main', 'index.js'),
    join(process.cwd(), 'dist', 'main', 'index.js'),
    join(process.cwd(), 'dist-electron', 'main', 'index.js'),
    join(process.cwd(), '.vite', 'build', 'main.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    'Electron main entry not found. Build the app first (`npm run build`).\n' +
      `Probed: ${candidates.join(', ')}`,
  );
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
}

/**
 * Boot the Electron app and return the app handle + first BrowserWindow page.
 * Passes a deterministic userData dir via env so session/recovery state never
 * leaks between test runs (the scaffold reads NOTEPADS_E2E_USERDATA if set).
 */
export async function launchApp(extraArgs: string[] = []): Promise<LaunchedApp> {
  const main = resolveMainEntry();
  const app = await electron.launch({
    args: [main, ...extraArgs],
    env: {
      ...process.env,
      NOTEPADS_E2E: '1',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
