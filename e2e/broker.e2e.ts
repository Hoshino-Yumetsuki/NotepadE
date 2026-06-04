import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * VERIFICATION GATE 6 — line 1: single-instance broker + activation
 * (docs/plan/06 §6.A + §GATE 6).
 *
 *   "Launch with a file argv opens it; a second instance redirects-vs-spawns per
 *    alwaysOpenNewWindow; notepads://newinstance spawns; a relative path resolves
 *    against the captured cwd."
 *
 * This drives the GENUINE broker (src/main, lane-a Phase 6) through the frozen
 * contract + activation push:
 *   - argv file open  → window.notepads.app.onActivation delivers the parsed paths,
 *     the renderer opens them, and the tab seam shows the opened file.
 *   - second instance → Electron's single-instance lock routes argv to the primary;
 *     with alwaysOpenNewWindow OFF the primary REDIRECTS (no new BrowserWindow),
 *     ON it SPAWNS a second BrowserWindow.
 *   - notepads://newinstance → always spawns regardless of the setting.
 *   - relative path     → resolved against the cwd captured at activation, not the
 *     primary's cwd.
 *
 * R10 LESSON (carried from Gate 5): the broker decision + cwd capture are MAIN-owned.
 * We drive them through the real MAIN seams (a second `electron.launch` models the
 * second instance; the settings contract flips alwaysOpenNewWindow) rather than any
 * renderer-side emulation.
 *
 * SCAFFOLD STATE: authored against the frozen window/app contract. The broker impl
 * (single-instance lock + activation routing) lands with 6.A; until then these are
 * `test.fixme` so the spec COMPILES + is discovered but does not red the suite.
 * FINALIZE STEP: flip each `test.fixme` → `test` once lane-a reports 6.A merged, then
 * prove green in isolation.
 */

/** Window count on an app handle (each BrowserWindow = one Page). */
function windowCount(app: ElectronApplication): number {
  return app.windows().length;
}

/** Open a deterministic temp workspace with one seed file; returns paths + cleanup. */
function seedWorkspace(label: string): { dir: string; file: string; name: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `np-broker-${label}-`));
  const name = 'opened-by-argv.txt';
  const file = join(dir, name);
  writeFileSync(file, 'broker argv content\n', 'utf8');
  return { dir, file, name, cleanup: () => safeRm(dir) };
}

/** Resolve the active tab's filePath via the renderer tab seam (PA-8-clean). */
async function activeFilePath(app: LaunchedApp): Promise<string | null> {
  return app.page.evaluate(() => {
    const seam = window.__notepadsTest?.tabs;
    if (!seam) return null;
    const id = seam.activeId();
    const tab = seam.list().find((t) => t.editorId === id);
    return tab?.filePath ?? null;
  });
}

/** Flip a single persisted setting through the frozen contract. */
async function setSetting(app: LaunchedApp, patch: Record<string, unknown>): Promise<void> {
  const res = await app.page.evaluate(
    (p) => window.notepads.settings.set(p as never),
    patch,
  );
  if (!res.ok) throw new Error(`settings.set failed: ${res.error}`);
}

test.describe('Gate 6 — single-instance broker + activation', () => {
  // ---- argv file open ----------------------------------------------------
  test('launching with a file argv opens that file in the first window', async () => {
    const ws = seedWorkspace('argv');
    const userDataDir = makeUserDataDir('np-broker-argv');
    const app = await launchApp({ userDataDir, extraArgs: [ws.file] });
    try {
      // The activation push (app.onActivation) carries the parsed argv paths; the
      // renderer opens them. Assert the opened file became the active tab.
      await expect
        .poll(() => activeFilePath(app), { timeout: 10_000 })
        .toBe(ws.file);
      const text = await app.page.evaluate(() => window.__notepadsTest.getEditorDocText());
      expect(text).toContain('broker argv content');
    } finally {
      await app.app.close();
      ws.cleanup();
      safeRm(userDataDir);
    }
  });

  // ---- second instance: REDIRECT when alwaysOpenNewWindow is OFF ----------
  test(
    'second instance with alwaysOpenNewWindow OFF redirects to the existing window (no spawn)',
    async () => {
      const ws = seedWorkspace('redirect');
      const userDataDir = makeUserDataDir('np-broker-redirect');
      const primary = await launchApp({ userDataDir });
      try {
        await setSetting(primary, { alwaysOpenNewWindow: false });
        expect(windowCount(primary.app)).toBe(1);

        // A second Electron process with the same userData hits the single-instance
        // lock; MAIN forwards its argv to the primary, which REDIRECTS (opens the file
        // in the existing window) instead of creating a BrowserWindow. The second
        // process should exit fast (lock not acquired).
        const second = await electron.launch({
          args: [resolveMainEntryForSecond(), ws.file],
          env: { ...process.env, NOTEPADS_E2E: '1', NOTEPADS_E2E_USERDATA: userDataDir },
        });
        // Give the primary a beat to receive the forwarded activation.
        await expect.poll(() => activeFilePath(primary), { timeout: 10_000 }).toBe(ws.file);
        // Still exactly ONE primary window — redirect, not spawn.
        expect(windowCount(primary.app)).toBe(1);
        await second.close().catch(() => void 0);
      } finally {
        await primary.app.close();
        ws.cleanup();
        safeRm(userDataDir);
      }
    },
  );

  // ---- second instance: SPAWN when alwaysOpenNewWindow is ON -------------
  test(
    'second instance with alwaysOpenNewWindow ON spawns a new window',
    async () => {
      const ws = seedWorkspace('spawn');
      const userDataDir = makeUserDataDir('np-broker-spawn');
      const primary = await launchApp({ userDataDir });
      try {
        await setSetting(primary, { alwaysOpenNewWindow: true });
        expect(windowCount(primary.app)).toBe(1);

        const newWin = primary.app.waitForEvent('window', { timeout: 10_000 });
        const second = await electron.launch({
          args: [resolveMainEntryForSecond(), ws.file],
          env: { ...process.env, NOTEPADS_E2E: '1', NOTEPADS_E2E_USERDATA: userDataDir },
        });
        const spawned = await newWin;
        await spawned.waitForLoadState('domcontentloaded');
        expect(windowCount(primary.app)).toBe(2);
        await second.close().catch(() => void 0);
      } finally {
        await primary.app.close();
        ws.cleanup();
        safeRm(userDataDir);
      }
    },
  );

  // ---- notepads://newinstance ALWAYS spawns -----------------------------
  test('notepads://newinstance spawns a window regardless of alwaysOpenNewWindow', async () => {
    const userDataDir = makeUserDataDir('np-broker-protocol');
    const primary = await launchApp({ userDataDir });
    try {
      await setSetting(primary, { alwaysOpenNewWindow: false }); // OFF — protocol overrides it
      const newWin = primary.app.waitForEvent('window', { timeout: 10_000 });
      const second = await electron.launch({
        args: [resolveMainEntryForSecond(), 'notepads://newinstance'],
        env: { ...process.env, NOTEPADS_E2E: '1', NOTEPADS_E2E_USERDATA: userDataDir },
      });
      const spawned = await newWin;
      await spawned.waitForLoadState('domcontentloaded');
      expect(windowCount(primary.app)).toBe(2);
      await second.close().catch(() => void 0);
    } finally {
      await primary.app.close();
      safeRm(userDataDir);
    }
  });

  // ---- relative path resolves against the captured cwd ------------------
  test('a relative-path activation resolves against the captured cwd', async () => {
    const ws = seedWorkspace('cwd');
    const userDataDir = makeUserDataDir('np-broker-cwd');
    const primary = await launchApp({ userDataDir });
    try {
      await setSetting(primary, { alwaysOpenNewWindow: false });
      // Launch the second instance with cwd = ws.dir and a BARE relative filename.
      // The broker must resolve it against THIS process's cwd (captured at activation),
      // yielding the absolute ws.file — not a path relative to the primary's cwd.
      const second = await electron.launch({
        args: [resolveMainEntryForSecond(), ws.name],
        cwd: ws.dir,
        env: { ...process.env, NOTEPADS_E2E: '1', NOTEPADS_E2E_USERDATA: userDataDir },
      });
      await expect.poll(() => activeFilePath(primary), { timeout: 10_000 }).toBe(ws.file);
      expect(basename(ws.file)).toBe(ws.name);
      await second.close().catch(() => void 0);
    } finally {
      await primary.app.close();
      ws.cleanup();
      safeRm(userDataDir);
    }
  });
});

/**
 * Resolve the built main entry for the SECOND-instance launches above. Mirrors
 * helpers/launch.ts resolveMainEntry (kept local so the broker spec owns its
 * second-process bootstrap without exporting internals from the shared helper).
 */
function resolveMainEntryForSecond(): string {
  const candidates = [
    join(process.cwd(), 'out', 'main', 'index.js'),
    join(process.cwd(), 'dist', 'main', 'index.js'),
    join(process.cwd(), 'dist-electron', 'main', 'index.js'),
    join(process.cwd(), '.vite', 'build', 'main.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('Electron main entry not found. Build first (`npm run build`).');
}
