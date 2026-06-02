import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { compareToBaseline, formatDiff } from '../scripts/visual-diff';
import { TAB_SELECTORS, seedTabs, clickTab, expectTabCount, resetToSingleTab } from './helpers/tabs';

/**
 * VERIFICATION GATE 2 — Golden-image diff (docs/plan/03 §GATE 2).
 *
 *   "Golden-image diff: tab strip <=0.1% pixel delta per theme."
 *
 * Captures the rendered tab strip per theme (Light / Dark / High-Contrast) and
 * diffs it against a committed baseline via pixelmatch (scripts/visual-diff.ts),
 * enforcing the <=0.1% tolerance.
 *
 * THEME SWITCHING:
 *   - Light / Dark: driven via Playwright `page.emulateMedia({ colorScheme })`,
 *     which App.tsx honors (reads prefers-color-scheme to pick web{Light,Dark}Theme).
 *   - High-Contrast (HC): driven via `page.emulateMedia({ forcedColors: 'active' })`.
 *     App.tsx detects `(forced-colors: active)` at mount and selects a strip-local
 *     HC token set (app-wide HC theming is deferred to Phase 5, but the strip — the
 *     subject of this gate — renders its HC variant today).
 *
 * BASELINE PROVENANCE:
 *   - Baselines under e2e/visual/baselines/** are tracked in Git LFS (.gitattributes).
 *   - Initial baselines are captured from THIS rendered component (a self-referential
 *     regression guard that catches unintended visual drift between commits).
 *   - REQUIRES_UWP_REFERENCE: for true 1:1 SetsView fidelity sign-off, each baseline
 *     must be REPLACED with a reference capture of the real UWP SetsView strip at the
 *     same DPI/scale. Those captures are NOT yet available — flagged to the lead.
 *
 * Capture flow:
 *   - `npm run visual:capture` sets NOTEPADS_VISUAL_UPDATE=1 to (re)write MISSING
 *     baselines from the current render, then commit them via LFS. CI never sets
 *     this (no auto-bless).
 */

const BASELINE_DIR = join(process.cwd(), 'e2e', 'visual', 'baselines');
const UPDATE_BASELINES = process.env.NOTEPADS_VISUAL_UPDATE === '1';

type ThemeName = 'light' | 'dark' | 'hc';
interface ThemeCase {
  name: ThemeName;
  colorScheme: 'light' | 'dark';
  /** Windows High-Contrast emulation — App.tsx selects the HC strip tokens. */
  forcedColors: 'active' | 'none';
}
const THEME_CASES: ThemeCase[] = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'hc', colorScheme: 'dark', forcedColors: 'active' },
];

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

/**
 * Arrange a deterministic strip: a fixed set of tabs with one active, one modified,
 * so the golden image is stable across runs (no clock/path variance).
 */
async function arrangeDeterministicStrip(): Promise<void> {
  const { page } = launched;
  await resetToSingleTab(page);
  const ids = await seedTabs(page, 3);
  await clickTab(page, ids[1]);
  // Mark one tab modified for the dirty-dot glyph; deterministic, no IO.
  await page.evaluate((dirtyId) => {
    window.__notepadsTest?.tabs?.setModified(dirtyId, true);
  }, ids[0]);
  await expectTabCount(page, 3);
}

for (const tc of THEME_CASES) {
  test(`tab strip golden image — ${tc.name} theme <=0.1% delta`, async () => {
    const { page } = launched;

    await page.emulateMedia({ colorScheme: tc.colorScheme, forcedColors: tc.forcedColors });
    await arrangeDeterministicStrip();

    const strip = page.locator(TAB_SELECTORS.strip);
    await expect(strip).toBeVisible();
    // Wait for fonts so glyph metrics are stable, then let dnd/resize settle.
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(250);

    // Capture via a page-level screenshot CLIPPED to the strip's box rather than
    // locator.screenshot(): the strip's ResizeObserver re-measures on every layout
    // tick, so element-level "stability" never settles and the locator screenshot
    // times out. A clip read from a one-shot boundingBox sidesteps that wait.
    // `animations: 'disabled'` freezes transitions (dnd reorder, Fluent ripple).
    const box = await strip.boundingBox();
    if (!box) throw new Error('tab strip has no bounding box (not laid out)');
    const actual = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
    });
    const baselinePath = join(BASELINE_DIR, `tab-strip-${tc.name}.png`);

    const result = compareToBaseline(actual, baselinePath, `tab-strip-${tc.name}`, {
      createMissingBaseline: UPDATE_BASELINES,
    });

    if (result.baselineCreated) {
      test.info().annotations.push({
        type: 'baseline-created',
        description: `Wrote new baseline ${baselinePath} (REQUIRES_UWP_REFERENCE for 1:1 sign-off).`,
      });
    }

    expect(result.pass, formatDiff(`tab-strip-${tc.name}`, result)).toBe(true);
  });
}
