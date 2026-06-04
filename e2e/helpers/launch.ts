import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

export interface LaunchOptions {
  /** Extra argv passed to the Electron main process. */
  extraArgs?: string[];
  /**
   * Deterministic Electron `userData` directory. When set it is exported as
   * NOTEPADS_E2E_USERDATA; MAIN calls `app.setPath('userData', ...)` to it
   * BEFORE `app.whenReady()` (session-main owns that override). Pass the SAME
   * dir to a second launchApp() call to model a kill→restart against the same
   * session/recovery state. When omitted, session/recovery state is isolated
   * per launch in a throwaway temp dir so runs never leak into each other.
   */
  userDataDir?: string;
  /** Extra environment variables merged into the child process env. */
  env?: Record<string, string>;
}

/**
 * Create a fresh, isolated, deterministic userData directory under the OS temp
 * dir. Use the returned path across two `launchApp` calls to drive the
 * dirty-kill → restart session-parity flow against the SAME session JSON +
 * backup files. Caller is responsible for cleanup (or let the OS reap temp).
 */
export function makeUserDataDir(label = 'notepads-e2e'): string {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  return dir;
}

/**
 * Best-effort recursive delete of a temp dir, tolerant of Windows EPERM.
 *
 * A second Electron instance (broker / two-window specs) holds a lock on a shared
 * userDataDir; on Windows the lock can outlive `app.close()` by a few ms, so a
 * naive `rmSync` in a test's `finally` throws EPERM and — fatally — that throw
 * OVERWRITES the real assertion failure in the report. This retries with a short
 * backoff and then gives up silently (the OS reaps the temp dir regardless), so
 * cleanup never masks the actual test outcome.
 */
export function safeRm(dir: string, attempts = 8, delayMs = 125): void {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i === attempts - 1) return; // give up: temp dir, OS will reap it
      const until = Date.now() + delayMs;
      while (Date.now() < until) {
        /* tiny synchronous backoff — keeps the helper sync for use in finally */
      }
    }
  }
}

/**
 * Boot the Electron app and return the app handle + first BrowserWindow page.
 *
 * Passes a deterministic userData dir via NOTEPADS_E2E_USERDATA so
 * session/recovery state is isolated per run (MAIN reads it and calls
 * `app.setPath('userData', ...)` before whenReady). Backwards-compatible: an
 * array first arg is still accepted as `extraArgs`.
 */
export async function launchApp(
  optionsOrArgs: string[] | LaunchOptions = {},
): Promise<LaunchedApp> {
  const options: LaunchOptions = Array.isArray(optionsOrArgs)
    ? { extraArgs: optionsOrArgs }
    : optionsOrArgs;
  const extraArgs = options.extraArgs ?? [];
  // Default to a throwaway isolated userData dir so session JSON never bleeds
  // between specs; callers wanting kill→restart pass an explicit, persistent dir.
  const userDataDir = options.userDataDir ?? makeUserDataDir();
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  const main = resolveMainEntry();
  const app = await electron.launch({
    args: [main, ...extraArgs],
    env: {
      ...process.env,
      NOTEPADS_E2E: '1',
      NOTEPADS_E2E_USERDATA: userDataDir,
      ...(options.env ?? {}),
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
