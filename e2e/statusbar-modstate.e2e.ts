import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync, utimesSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';

/**
 * VERIFICATION GATE 4 — line 3: "external-modification indicator behaves per
 * matrix" (docs/plan/05 §4.C, Lane C).
 *
 * Drives the REAL column-0 state machine (useStatusBarModel + fileStatusTracker)
 * through the genuine open/reload flow plus the PA-8-clean status-bar test seam
 * `window.__notepadsTest.statusbar.checkFileStatus()` (the renderer cannot wait
 * on the ~3s poll timer in a test, so the seam forces one synchronous check via
 * window.notepads.file.revalidatePath).
 *
 * Matrix (UWP UpdateFileModificationStateIndicator, StatusBar.cs:79):
 *   (a) file rewritten on disk with a newer mtime → 'modifiedOutside' (E7BA visible)
 *   (b) reload from disk re-baselines → back to 'none' (column collapses)
 *   (c) file deleted on disk → 'renamedMovedDeleted' (E9CE visible)
 *
 * The runner owns all fs mutations (renderer never touches fs). E7BA/E9CE are the
 * Segoe MDL2 codepoints the StatusBar renders in column 0.
 */

const E7BA = String.fromCharCode(0xe7ba); // modified outside (Warning)
const E9CE = String.fromCharCode(0xe9ce); // renamed/moved/deleted (Unknown)

const MOD_STATE = '[data-testid="status-mod-state"]';

let launched: LaunchedApp;
let workFile: string;

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notepads-modstate-'));
  workFile = join(dir, 'watched.txt');
  writeFileSync(workFile, 'initial contents\n', 'utf8');
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
  try {
    rmSync(workFile, { force: true });
  } catch {
    /* best-effort cleanup */
  }
});

test('external-modification indicator: modifiedOutside → reload → renamedMovedDeleted', async () => {
  const { page } = launched;

  // --- OPEN via the real renderer flow; seeds the column-0 mtime baseline. ---
  const openResult = await page.evaluate(
    (path) => window.__notepadsTest.openFileIntoEditor(path),
    workFile,
  );
  expect(openResult.ok, `open failed: ${JSON.stringify(openResult)}`).toBe(true);

  // Baseline check: file untouched since open → 'none', column-0 placeholder empty.
  const initial = await page.evaluate(() => window.__notepadsTest.statusbar!.checkFileStatus());
  expect(initial).toBe('none');
  await expect(page.locator(MOD_STATE)).toHaveText('');

  // --- (a) rewrite on disk with a NEWER mtime → modifiedOutside (E7BA) ---
  writeFileSync(workFile, 'changed by another editor\n', 'utf8');
  // Force the mtime forward so the change is unambiguous even on coarse clocks.
  const future = new Date(Date.now() + 5000);
  utimesSync(workFile, future, future);

  const afterEdit = await page.evaluate(() => window.__notepadsTest.statusbar!.checkFileStatus());
  expect(afterEdit).toBe('modifiedOutside');
  await expect(page.locator(MOD_STATE)).toContainText(E7BA);

  // --- (b) reload via the bar's own column-0 flyout re-baselines → 'none' ---
  // The modifiedOutside indicator wraps a Menu; clicking it opens the reload
  // flyout whose item runs the REAL onReloadFromDisk handler (reload + re-record
  // the mtime baseline + reset state), exactly the UWP affordance.
  await page.locator(MOD_STATE).click({ force: true });
  await expect(page.locator('[data-testid="status-mod-state-menu"]')).toBeVisible();
  await page.locator('[data-testid="status-mod-state-reload"]').click({ force: true });

  // After the reload re-baselines, a fresh check resolves to 'none' and the
  // column-0 placeholder collapses again.
  await expect
    .poll(() => page.evaluate(() => window.__notepadsTest.statusbar!.checkFileStatus()))
    .toBe('none');
  await expect(page.locator(MOD_STATE)).toHaveText('');

  // --- (c) delete the file on disk → renamedMovedDeleted (E9CE) ---
  rmSync(workFile, { force: true });
  const afterDelete = await page.evaluate(() => window.__notepadsTest.statusbar!.checkFileStatus());
  expect(afterDelete).toBe('renamedMovedDeleted');
  await expect(page.locator(MOD_STATE)).toContainText(E9CE);
});
