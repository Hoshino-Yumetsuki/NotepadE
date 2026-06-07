import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { compareToBaseline, formatDiff } from '../scripts/visual-diff';
import {
  TAB_SELECTORS,
  seedTabs,
  clickTab,
  expectTabCount,
  resetToSingleTab,
} from './helpers/tabs';
import { driveOsTheme } from './helpers/settings';

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
  test(`tab strip golden image — ${tc.name} theme <=0.1% delta @visual`, async () => {
    const { app, page } = launched;

    // R10: the resolved light/dark bucket is owned by MAIN's nativeTheme (the
    // renderer never reads prefers-color-scheme for it — PA-8), so emulateMedia
    // alone is a false-green that only "works" after a prior test nudged
    // nativeTheme. Drive the MAIN seam per-case so each is self-contained and
    // passes IN ISOLATION (the first test no longer inherits the default bucket).
    await driveOsTheme(app, tc.colorScheme);
    await page.emulateMedia({ colorScheme: tc.colorScheme, forcedColors: tc.forcedColors });
    // HC: useAppTheme reads forced-colors AT MOUNT, so a fresh reload is needed for
    // the renderer to re-resolve the 'hc' bucket from the live query (golden.ts flow).
    if (tc.name === 'hc') {
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }
    await arrangeDeterministicStrip();

    const strip = page.locator(TAB_SELECTORS.strip);
    await expect(strip).toBeVisible();

    // R9 GUARD (docs/plan/11 risk R9): the visual e2e drives themes via
    // emulateMedia WITHOUT a page.reload(); a regression to mount-only theme
    // reading would silently re-introduce the all-light "false green" the
    // baselines can't catch. Before the pixel diff, assert the theme ACTUALLY
    // resolved so a theme-read regression fails LOUDLY here instead of diffing
    // against the wrong baseline. Two independent signals:
    //   1. The strip's own data-theme attribute — the strongest signal that the
    //      renderer genuinely resolved the bucket (a mount-only regression would
    //      pin this to the wrong value). The strip's own BACKGROUND is no longer a
    //      valid probe: post-acrylic (commit bcca234) the strip is intentionally
    //      `transparent` in light/dark (the app acrylic shows through), so the
    //      resolved surface color lives on the app-shell ancestor, not the strip.
    //   2. light/dark: the painted app-shell root luminance band (light #F0F0F0
    //      ≈ 240, dark #2E2E2E ≈ 46), read off the nearest non-transparent
    //      ancestor; hc: forced-colors genuinely active (keywords resolve to the
    //      user palette, so there is no fixed RGB to assert).
    const expectedTheme = tc.name === 'hc' ? 'hc' : tc.name;
    await expect(strip).toHaveAttribute('data-theme', expectedTheme);

    if (tc.name === 'hc') {
      // HC: confirm forced-colors is genuinely active in the page (the reactivity
      // R9 protects). If this query is false the HC capture is meaningless.
      const forcedActive = await page.evaluate(
        () => window.matchMedia('(forced-colors: active)').matches,
      );
      expect(forcedActive, 'HC capture requires forced-colors: active to be live').toBe(true);
    } else {
      // light/dark: walk up from the (transparent) strip to the first ancestor
      // with a non-transparent background and read its luminance — that is the
      // app-shell surface the acrylic paints over.
      const bgLuma = await strip.evaluate((el) => {
        let node: Element | null = el;
        while (node) {
          // Match decimals too: an alpha of "0.5" must not split into [0,5] (which
          // would misread the channel as transparent and skip a painted surface).
          const m = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
          if (m) {
            const [r, g, b, a] = m.map(Number);
            if (a === undefined || a > 0) return 0.299 * r + 0.587 * g + 0.114 * b;
          }
          node = node.parentElement;
        }
        return -1;
      });
      if (tc.name === 'light') {
        expect(bgLuma, `light app surface luminance (got ${bgLuma})`).toBeGreaterThan(180);
      } else {
        expect(
          bgLuma,
          `dark app surface luminance (got ${bgLuma}) — a value >180 means the theme read regressed to light`,
        ).toBeLessThan(120);
      }
    }

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

    const result = await compareToBaseline(actual, baselinePath, `tab-strip-${tc.name}`, {
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
