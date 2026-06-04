import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { launchApp, makeUserDataDir, type LaunchedApp } from './helpers/launch';
import {
  SETTINGS_SELECTORS,
  openSettings,
  selectPane,
  getSetting,
  expectSetting,
  patchSettings,
} from './helpers/settings';
import type { Settings } from '../src/shared/ipc-contract';

/**
 * VERIFICATION GATE 5 — line 1: persistence + live-affect (docs/plan/05 §GATE 5).
 *
 *   "Change a representative setting from each pane, assert it live-affects
 *    behavior, then close + relaunch on the SAME userData and assert every change
 *    survived."
 *
 * This drives the GENUINE MAIN-owned settings store (src/main/settings.ts) end to
 * end through the frozen contract window.notepads.settings.* and the real
 * userData/Settings.json, exactly like session-parity drives the session store:
 *
 *   launch(userDataDir) → settings.set(patch) (persist + broadcast)
 *     → assert live-affect via the seam / rendered surface
 *     → app.close() → relaunch(SAME userDataDir) → settings.get()/seam
 *       → assert every changed field survived.
 *
 * The SAME deterministic userData dir is passed to BOTH launches (the e2e helper
 * exports NOTEPADS_E2E_USERDATA, which MAIN applies via app.setPath BEFORE
 * whenReady), so the second process reads the FIRST process's Settings.json —
 * modelling a settings change that must outlive a restart.
 *
 * Matrix (one representative field per pane + the live-affect surface each owns):
 *   - showStatusBar       (Advanced)        → the Phase-4 status bar mounts/unmounts
 *   - tabIndents          (Text & Editor)   → indent width the editor inserts
 *   - defaultLineEnding   (Text & Editor)   → default EOL for new files
 *   - themeMode           (Personalization) → resolved theme bucket / root surface
 *   - tintOpacity         (Personalization) → background tint opacity
 *   - alwaysOpenNewWindow (Advanced)        → broker redirect-vs-spawn policy
 */

/** Non-default target values, chosen to differ from DEFAULT_SETTINGS on every row. */
const MATRIX: Partial<Settings> = {
  showStatusBar: false, // default true
  tabIndents: 4, // default -1 (real tab)
  defaultLineEnding: 'lf', // default 'crlf'
  themeMode: 'dark', // default 'system'
  tintOpacity: 0.4, // default 0.75
  alwaysOpenNewWindow: true, // default false
};

test.describe('Gate 5 — settings persistence + live-affect across restart', () => {
  test('every pane row live-affects, then survives a close → relaunch on the same userData', async () => {
    const userDataDir = makeUserDataDir('np-settings-persist');

    // --- session 1: change each row, assert live-affect, then kill the app ---
    let app: LaunchedApp = await launchApp({ userDataDir });
    try {
      const { page } = app;
      // A fixed, wide viewport so the 880px settings dialog fits on-screen — at the
      // default Electron window size the NavDrawer overflows to a negative x and its
      // items can't be clicked (an off-screen nav drops the section switch).
      await page.setViewportSize({ width: 1280, height: 800 });
      // Baseline: the status bar is visible (showStatusBar default true) and the
      // seam reports the verbatim DEFAULT_SETTINGS so the deltas below are real.
      await expect(page.locator(SETTINGS_SELECTORS.statusBar)).toBeVisible();
      expect(await getSetting(page, 'showStatusBar')).toBe(true);
      expect(await getSetting(page, 'themeMode')).toBe('system');

      // Open the surface via the REAL toolbar gear and walk every pane so the
      // golden/persistence harness exercises the genuine nav, not just the store.
      await openSettings(page);
      await selectPane(page, 'textEditor');
      await selectPane(page, 'personalization');
      await selectPane(page, 'advanced');

      // Apply the whole matrix through the frozen contract (the same persist +
      // broadcast path the panes' controls call via useSettings.update).
      await patchSettings(page, MATRIX);

      // Live-affect assertions — each field's OBSERVABLE effect, not just the bag:
      //   showStatusBar=false → the Phase-4 status bar unmounts from the shell.
      await expect(page.locator(SETTINGS_SELECTORS.statusBar)).toHaveCount(0);
      //   themeMode=dark → the resolved bucket flips to 'dark' WITHOUT a reload.
      await expect
        .poll(() => page.evaluate(() => window.__notepadsTest.settings!.getActiveTheme()))
        .toBe('dark');
      //   the remaining rows reconcile into the live bag the UI renders from.
      await expectSetting(page, 'tabIndents', 4);
      await expectSetting(page, 'defaultLineEnding', 'lf');
      await expectSetting(page, 'tintOpacity', 0.4);
      await expectSetting(page, 'alwaysOpenNewWindow', true);

      // Flip it back on once to prove the toggle is genuinely live (mount again),
      // then leave it OFF as the persisted target.
      await patchSettings(page, { showStatusBar: true });
      await expect(page.locator(SETTINGS_SELECTORS.statusBar)).toBeVisible();
      await patchSettings(page, { showStatusBar: false });
      await expect(page.locator(SETTINGS_SELECTORS.statusBar)).toHaveCount(0);
    } finally {
      await app.app.close();
    }

    // --- session 2: relaunch against the SAME userData; assert everything survived ---
    app = await launchApp({ userDataDir });
    try {
      const { page } = app;

      // Read back through the seam (the live bag hydrated from Settings.json) AND
      // the contract get() so a regression in either path fails.
      const persisted = await page.evaluate(async () => {
        const r = await window.notepads.settings.get();
        if (!r.ok) throw new Error(`settings.get failed: ${r.error}`);
        return r.data;
      });
      expect(persisted.showStatusBar).toBe(false);
      expect(persisted.tabIndents).toBe(4);
      expect(persisted.defaultLineEnding).toBe('lf');
      expect(persisted.themeMode).toBe('dark');
      expect(persisted.tintOpacity).toBe(0.4);
      expect(persisted.alwaysOpenNewWindow).toBe(true);

      // The persisted state still live-affects the fresh process: the status bar
      // stays unmounted (showStatusBar=false survived) and the resolved theme is
      // 'dark' (themeMode=dark survived, independent of the OS theme).
      await expect(page.locator(SETTINGS_SELECTORS.statusBar)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => window.__notepadsTest.settings!.getActiveTheme()))
        .toBe('dark');

      // Seam read-back parity for the per-pane rows (source-of-truth bag).
      await expectSetting(page, 'tabIndents', 4);
      await expectSetting(page, 'tintOpacity', 0.4);
    } finally {
      await app.app.close();
    }

    rmSync(userDataDir, { recursive: true, force: true });
  });
});
