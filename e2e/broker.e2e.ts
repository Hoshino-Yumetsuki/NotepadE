import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
 * R10 LESSON + ARCHITECTURE: the broker decision + cwd capture are MAIN-owned. The
 * single-instance lock is DELIBERATELY skipped under NOTEPADS_E2E (src/main/index.ts),
 * so a second `electron.launch` under the same flag becomes its OWN primary and never
 * drives the real `second-instance` redirect/cwd path on the first process — the
 * second-instance flow is unreachable across two e2e processes by design. So this
 * suite drives the GENUINE broker IN-PROCESS through the MAIN test seam
 * (globalThis.__notepadsMainTest, installed only under NOTEPADS_E2E — see
 * src/main/broker.ts §MAIN test seam). The seam routes through the SAME
 * `routeActivation` / `parseArgv` production uses; it does not emulate. This mirrors
 * the renderer transfer seam: real code paths, no fake drop / no second process.
 *
 *   - simulateSecondInstance(argv, cwd) = parse argv against cwd, then route (exactly
 *     what the real OS 'second-instance' handler does), reporting the resulting live
 *     window count + the target window id. Redirect ⇒ count unchanged; spawn ⇒ count+1.
 *   - routeActivation(event) drives an already-built activation (the argv-open path).
 *   - parseArgv / resolveCwdRelative / isNewInstanceProtocol are the pure helpers.
 */

/** Read the MAIN seam's live window count (live BrowserWindows). */
async function windowCount(app: LaunchedApp): Promise<number> {
  return app.app.evaluate(() => {
    const seam = (globalThis as { __notepadsMainTest?: { windowCount(): number } })
      .__notepadsMainTest;
    if (!seam) throw new Error('__notepadsMainTest seam missing (NOTEPADS_E2E not set?)');
    return seam.windowCount();
  });
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
  const res = await app.page.evaluate((p) => window.notepads.settings.set(p as never), patch);
  if (!res.ok) throw new Error(`settings.set failed: ${res.error}`);
}

/** Drive the GENUINE OS 'second-instance' in-process via the MAIN seam. */
async function simulateSecondInstance(
  app: LaunchedApp,
  argv: string[],
  cwd: string,
): Promise<{ paths: string[]; protocolUrl: string | null; windowCount: number }> {
  return app.app.evaluate(
    async (_electron, arg: { argv: string[]; cwd: string }) => {
      const seam = (
        globalThis as {
          __notepadsMainTest?: {
            simulateSecondInstance(
              argv: readonly string[],
              cwd: string,
            ): Promise<{
              parsed: { paths: string[]; protocolUrl: string | null };
              windowCount: number;
              targetId: number | null;
            }>;
          };
        }
      ).__notepadsMainTest;
      if (!seam) throw new Error('__notepadsMainTest seam missing');
      // Prepend the real exec path so parseArgv skips electron's own argv[0].
      const full = [process.execPath, ...arg.argv];
      const r = await seam.simulateSecondInstance(full, arg.cwd);
      return {
        paths: r.parsed.paths,
        protocolUrl: r.parsed.protocolUrl,
        windowCount: r.windowCount,
      };
    },
    { argv, cwd },
  );
}

test.describe('Gate 6 — single-instance broker + activation', () => {
  // ---- argv file open ----------------------------------------------------
  test('launching with a file argv opens that file in the first window', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-broker-argv-'));
    const file = join(dir, 'opened-by-argv.txt');
    writeFileSync(file, 'broker argv content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-broker-argv');
    const app = await launchApp({ userDataDir, extraArgs: [file] });
    try {
      // The activation push (app.onActivation, driven by the cold-start argv routing)
      // carries the parsed argv paths; the renderer opens them. Assert the opened file
      // became the active tab AND its content loaded (CM6 doc-load fix, bb4de55).
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
      const text = await app.page.evaluate(() => window.__notepadsTest.getEditorDocText());
      expect(text).toContain('broker argv content');
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  // ---- second instance: REDIRECT when alwaysOpenNewWindow is OFF ----------
  test('second instance with alwaysOpenNewWindow OFF redirects (no spawn)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-broker-redirect-'));
    const file = join(dir, 'redirect.txt');
    writeFileSync(file, 'redirect content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-broker-redirect');
    const app = await launchApp({ userDataDir });
    try {
      await setSetting(app, { alwaysOpenNewWindow: false });
      expect(await windowCount(app)).toBe(1);
      // OS second-instance with the file: the broker REDIRECTS into the existing window.
      const r = await simulateSecondInstance(app, [file], dir);
      expect(r.paths).toEqual([file]);
      // Still exactly ONE window — redirect, not spawn.
      expect(r.windowCount, 'redirect keeps a single window').toBe(1);
      expect(await windowCount(app)).toBe(1);
      // The redirected file opened in the existing window.
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  // ---- second instance: SPAWN when alwaysOpenNewWindow is ON -------------
  test('second instance with alwaysOpenNewWindow ON spawns a new window', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-broker-spawn-'));
    const file = join(dir, 'spawn.txt');
    writeFileSync(file, 'spawn content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-broker-spawn');
    const app = await launchApp({ userDataDir });
    try {
      await setSetting(app, { alwaysOpenNewWindow: true });
      expect(await windowCount(app)).toBe(1);
      const r = await simulateSecondInstance(app, [file], dir);
      expect(r.paths).toEqual([file]);
      // alwaysOpenNewWindow ON → the broker SPAWNS a second BrowserWindow.
      expect(r.windowCount, 'spawn adds a window').toBe(2);
      expect(await windowCount(app)).toBe(2);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  // ---- notepads://newinstance ALWAYS spawns -----------------------------
  test('notepads://newinstance spawns a window regardless of alwaysOpenNewWindow', async () => {
    const userDataDir = makeUserDataDir('np-broker-protocol');
    const app = await launchApp({ userDataDir });
    try {
      await setSetting(app, { alwaysOpenNewWindow: false }); // OFF — protocol overrides it
      expect(await windowCount(app)).toBe(1);
      const r = await simulateSecondInstance(app, ['notepads://newinstance'], process.cwd());
      expect(r.protocolUrl, 'protocol url parsed').toBe('notepads://newinstance');
      // newinstance overrides the OFF setting → spawns regardless.
      expect(r.windowCount, 'newinstance always spawns').toBe(2);
      expect(await windowCount(app)).toBe(2);
    } finally {
      await app.app.close();
      safeRm(userDataDir);
    }
  });

  // ---- relative path resolves against the captured cwd ------------------
  test('a relative-path activation resolves against the captured cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-broker-cwd-'));
    const name = 'cwd-relative.txt';
    const file = join(dir, name);
    writeFileSync(file, 'cwd content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-broker-cwd');
    const app = await launchApp({ userDataDir });
    try {
      await setSetting(app, { alwaysOpenNewWindow: false });
      // A BARE relative filename with cwd = dir must resolve against THAT cwd (captured
      // at activation), yielding the absolute file — not a path relative to the primary.
      const r = await simulateSecondInstance(app, [name], dir);
      expect(r.paths, 'bare relative token resolved against the activation cwd').toEqual([file]);
      expect(basename(file)).toBe(name);
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });
});
