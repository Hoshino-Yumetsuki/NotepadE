import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { compareToBaseline, formatDiff } from '../scripts/visual-diff';
import {
  SETTINGS_SELECTORS,
  openSettings,
  selectPane,
  patchSettings,
  getActiveTheme,
  forceSurfaceOpaqueForCapture
} from './helpers/settings';

/**
 * VERIFICATION GATE 5 — line 3: settings-pane golden (docs/plan/05 §GATE 5).
 *
 *   "Pixelmatch golden ≤0.1% per theme (light/dark/hc) for the settings surface."
 *
 * Captures the rendered settings surface per theme (Light / Dark / High-Contrast)
 * and diffs it against a committed baseline via pixelmatch (scripts/visual-diff.ts),
 * enforcing the ≤0.1% tolerance — the same harness + tolerance as the Gate-2 tab
 * strip and the Gate-4 status bar.
 *
 * THEME SWITCHING: driven via emulateMedia (colorScheme + forcedColors) with
 * themeMode='system', exactly like the tab-strip / status-bar visual flows;
 * useAppTheme re-resolves the bucket reactively (no reload).
 *
 * R9 GUARD: before each pixel diff this asserts the surface ACTUALLY entered the
 * emulated theme (the resolved bucket via the seam, plus the live forced-colors
 * query for hc) so a theme-read regression fails LOUDLY here instead of diffing
 * against the wrong baseline.
 *
 * BASELINE PROVENANCE: identical policy to tabs-visual / statusbar-visual —
 * baselines under e2e/visual/baselines/** are tracked in Git LFS (.gitattributes);
 * initial baselines are captured from THIS render via `npm run visual:capture`
 * (NOTEPADS_VISUAL_UPDATE=1) as a self-referential regression guard.
 * REQUIRES_UWP_REFERENCE for true 1:1 SettingsPage fidelity sign-off (R8).
 */

const BASELINE_DIR = join(process.cwd(), 'e2e', 'visual', 'baselines');
const UPDATE_BASELINES = process.env.NOTEPADS_VISUAL_UPDATE === '1';

type ThemeName = 'light' | 'dark' | 'hc';
interface ThemeCase {
  name: ThemeName;
  colorScheme: 'light' | 'dark';
  forcedColors: 'active' | 'none';
}
const THEME_CASES: ThemeCase[] = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'hc', colorScheme: 'dark', forcedColors: 'active' }
];

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  // A FIXED viewport makes the dialog box (and therefore the golden) deterministic
  // across runs / machines — without it the Electron window size varies and the
  // baseline dimensions never reproduce.
  await launched.page.setViewportSize({ width: 1280, height: 800 });
});

test.afterAll(async () => {
  await launched?.app.close();
});

/**
 * Arrange a deterministic settings surface for the golden, opened fresh each case
 * to avoid prior-pane scroll drift. The OS accent (no custom hex variance) and the
 * Text & Editor pane are fixed so every theme captures the SAME pane content.
 *
 * The bucket is pinned DETERMINISTICALLY rather than inferred from the OS scheme:
 *   - light/dark → themeMode is set explicitly (resolveBucket returns the mode
 *     verbatim when it is not 'system'), so the capture never races the
 *     prefers-color-scheme propagation. (An isolated 'dark' run surfaced that race
 *     as an R9 failure — emulateMedia({colorScheme}) alone didn't settle the bucket
 *     on a cold launch.)
 *   - hc → forced-colors:'active' wins over themeMode in resolveBucket, so a fixed
 *     'light' mode under forcedColors still resolves to 'hc'.
 *
 * The surface is opened ONCE (kept open across cases): re-clicking the gear while
 * the modal is open would land on the backdrop, and a close→reopen toggle races the
 * Fluent close/open motion (an observed failure left the dialog shut and the capture
 * waiting forever on an absent surface). The surface re-themes LIVE on the themeMode
 * / forced-colors change, so reusing the open dialog is both correct and stable.
 */
async function arrangeSettingsSurface(tc: ThemeCase): Promise<void> {
  const { page } = launched;
  const themeMode = tc.name === 'dark' ? 'dark' : 'light';
  await patchSettings(page, { themeMode, useWindowsAccentColor: true });
  // Open via the gear only if the surface isn't already up (first case opens it;
  // later cases reuse the live-re-themed dialog).
  const alreadyOpen = await page.locator(SETTINGS_SELECTORS.surface).count();
  if (alreadyOpen === 0) {
    await openSettings(page);
  }
  await selectPane(page, 'textEditor');
  // Pin the surface opaque so the golden capture is independent of the Fluent open
  // motion (its opacity-0 base does not reliably resolve to 1 under Electron WAAPI).
  await forceSurfaceOpaqueForCapture(page);
}

for (const tc of THEME_CASES) {
  test(`settings surface golden image — ${tc.name} theme <=0.1% delta @visual`, async () => {
    const { page } = launched;

    await page.emulateMedia({ colorScheme: tc.colorScheme, forcedColors: tc.forcedColors });
    await arrangeSettingsSurface(tc);

    const surface = page.locator(SETTINGS_SELECTORS.surface);
    await expect(surface).toBeVisible();

    // R9 GUARD: assert the surface genuinely entered the target theme BEFORE the
    // pixel diff. getActiveTheme() is the resolved FluentProvider bucket; for hc we
    // additionally confirm forced-colors is live (its keywords resolve to the user
    // palette, so there is no fixed RGB to luma-check).
    await expect.poll(() => getActiveTheme(page)).toBe(tc.name);
    if (tc.name === 'hc') {
      const forcedActive = await page.evaluate(
        () => window.matchMedia('(forced-colors: active)').matches
      );
      expect(forcedActive, 'HC capture requires forced-colors: active to be live').toBe(true);
    }

    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(250);

    // Capture via a page-level screenshot CLIPPED to the surface box (Fluent's
    // Dialog re-measures on layout ticks; a one-shot boundingBox clip sidesteps the
    // element-stability wait that stalls a locator screenshot). animations:'disabled'
    // freezes Fluent ripples; the open transition is already settled above.
    const box = await surface.boundingBox();
    if (!box) throw new Error('settings surface has no bounding box (not laid out)');
    const actual = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      }
    });
    const baselinePath = join(BASELINE_DIR, `settings-${tc.name}.png`);

    const result = await compareToBaseline(actual, baselinePath, `settings-${tc.name}`, {
      createMissingBaseline: UPDATE_BASELINES
    });

    if (result.baselineCreated) {
      test.info().annotations.push({
        type: 'baseline-created',
        description: `Wrote new baseline ${baselinePath} (REQUIRES_UWP_REFERENCE for 1:1 sign-off).`
      });
    }

    expect(result.pass, formatDiff(`settings-${tc.name}`, result)).toBe(true);
  });
}
