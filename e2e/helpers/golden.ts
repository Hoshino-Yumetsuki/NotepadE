import { expect, type Page, type Locator, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { compareToBaseline, formatDiff } from '../../scripts/visual-diff';
import { driveOsTheme } from './settings';

/**
 * Shared golden-image capture harness — VERIFICATION GATE 7 (lane-h).
 *
 * The Gate-2/4/5 visual specs (tabs-visual, statusbar-visual, settings-visual)
 * each re-implemented the same per-theme capture dance inline, and they DIVERGED:
 * tabs-visual drove light/dark via emulateMedia only, while statusbar-visual drove
 * it through the MAIN nativeTheme seam + a page.reload() for HC and an R9 data-theme
 * guard. The newest pattern (statusbar-visual) is the correct one — it is the R10
 * lesson: MAIN owns the OS theme via nativeTheme, the renderer reads it through
 * window.notepads.theme (PA-8), so an emulated prefers-color-scheme alone is a false
 * green that only passes after an earlier test nudged nativeTheme. Gate-7 adds four
 * NEW surfaces (acrylic / reveal / edge-shadow / toast) × three themes, so rather
 * than copy the divergent dance a fourth time this helper encodes the canonical
 * flow ONCE:
 *
 *   1. R10 isolation — driveOsTheme(app, scheme) [MAIN nativeTheme via app.evaluate]
 *      PLUS page.emulateMedia({colorScheme, forcedColors}) so each case is
 *      self-contained and passes IN ISOLATION, not only after a prior test.
 *   2. HC hardening — emulateMedia({forcedColors:'active'}) sets the query but does
 *      not fire a `change` event into a freshly-launched renderer; useAppTheme only
 *      resolves the 'hc' bucket by reading the query AT MOUNT, so a page.reload()
 *      (R9 freshly-reloaded-page hardening) is required. emulateMedia + nativeTheme
 *      both persist across a renderer reload.
 *   3. Caller-supplied arrange() runs AFTER theme is applied (it may depend on the
 *      theme, e.g. opening a surface), and an optional R9 guard asserts the surface
 *      ACTUALLY entered the emulated theme BEFORE the diff — so a theme-read
 *      regression fails LOUDLY here instead of silently diffing the wrong baseline.
 *   4. fonts.ready + a short settle, then a page-level screenshot CLIPPED to the
 *      target's boundingBox (locator.screenshot() never settles when a surface
 *      re-measures via ResizeObserver), animations:'disabled' to freeze transitions.
 *   5. compareToBaseline at the Gate ≤0.1% tolerance; first run writes the MISSING
 *      baseline only under NOTEPADS_VISUAL_UPDATE=1 (never auto-bless in CI).
 *
 * R8 CAVEAT (provenance): the new-surface baselines are SELF-REFERENTIAL drift
 * guards captured from THIS render — they catch unintended pixel drift between
 * commits but do NOT prove 1:1 parity with the real UWP surface. FINAL visual
 * sign-off REQUIRES_UWP_REFERENCE captures (flagged via a test annotation on every
 * baseline this helper creates, and tracked on the risk register).
 *
 * TEST-SIDE ONLY: e2e/ + scripts/ are test tooling, so importing node:path /
 * scripts/visual-diff here does not violate PA-8 (renderer rule covers
 * src/renderer/** only).
 */

export const BASELINE_DIR = join(process.cwd(), 'e2e', 'visual', 'baselines');

/** Whether the run may FILL a missing baseline (set by `npm run visual:capture`). */
export const UPDATE_BASELINES = process.env.NOTEPADS_VISUAL_UPDATE === '1';

export type ThemeName = 'light' | 'dark' | 'hc';

export interface ThemeCase {
  name: ThemeName;
  colorScheme: 'light' | 'dark';
  forcedColors: 'active' | 'none';
}

/**
 * The three Gate-7 theme cases. HC pairs forced-colors with the dark colorScheme
 * (Windows High-Contrast is a dark-family palette) — identical to the Gate-4 cases.
 */
export const THEME_CASES: readonly ThemeCase[] = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'hc', colorScheme: 'dark', forcedColors: 'active' },
] as const;

/**
 * Apply a theme case to a launched app using the canonical R10 + HC-reload flow.
 * Returns after the renderer has settled into the requested theme (caller should
 * then run its arrange() — which may itself depend on the now-applied theme).
 *
 * NOTE: a page.reload() is issued for HC, which unmounts the renderer. Any
 * arrange() that opens a surface must therefore run AFTER this call (it does in
 * captureGolden below), and any beforeAll-seeded transient UI state is lost on the
 * HC case — callers needing persistent arrangement should re-arrange in arrange().
 */
export async function applyTheme(
  app: ElectronApplication,
  page: Page,
  tc: ThemeCase,
): Promise<void> {
  // R10: MAIN nativeTheme is authoritative for the light/dark bucket (the renderer
  // never reads prefers-color-scheme for it). Drive the seam per-case via app.evaluate.
  await driveOsTheme(app, tc.colorScheme);
  await page.emulateMedia({ colorScheme: tc.colorScheme, forcedColors: tc.forcedColors });
  // R9/HC: a fresh page only resolves the 'hc' bucket by reading forced-colors AT
  // MOUNT; reload so useAppTheme re-initializes highContrast from the live query.
  if (tc.name === 'hc') {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  }
}

/**
 * R9 pre-diff theme-assert guard. Confirms the page actually entered `tc`'s theme
 * BEFORE the pixel diff, so a theme-read regression fails loudly here. Two checks:
 *   - light/dark: the app-shell root surface luminance band (light ≈ 240, dark ≈ 46),
 *     read off the FluentProvider root which App paints from the resolved theme.
 *   - hc: forced-colors is genuinely active in the page (HC keywords resolve to the
 *     user palette, so there is no fixed RGB to assert; a dead query = meaningless HC).
 * An optional `guardLocator` lets a surface assert its own data-theme attribute too.
 */
export async function assertThemeGuard(
  page: Page,
  tc: ThemeName,
  guardLocator?: Locator,
): Promise<void> {
  if (guardLocator) {
    // Surfaces that expose data-theme (StatusBar pattern) get the strongest guard.
    if (tc === 'hc') {
      await expect(guardLocator).toHaveAttribute('data-theme', 'hc');
    } else {
      await expect(guardLocator).toHaveAttribute('data-theme', tc);
    }
  }

  if (tc === 'hc') {
    const forcedActive = await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches,
    );
    expect(forcedActive, 'HC capture requires forced-colors: active to be live').toBe(true);
    return;
  }

  const rootLuma = await page.evaluate(() => {
    const root = document.querySelector('.fui-FluentProvider') ?? document.body;
    const m = getComputedStyle(root as Element).backgroundColor.match(/\d+/g);
    if (!m) return -1;
    const [r, g, b] = m.map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  });
  if (tc === 'light') {
    expect(rootLuma, `light root surface luminance (got ${rootLuma})`).toBeGreaterThan(180);
  } else {
    expect(
      rootLuma,
      `dark root surface luminance (got ${rootLuma}) — >120 means the theme read regressed to light`,
    ).toBeLessThan(120);
  }
}

export interface CaptureGoldenArgs {
  app: ElectronApplication;
  page: Page;
  tc: ThemeCase;
  /**
   * Stable baseline component slug (e.g. 'acrylic-surface'); the baseline file is
   * `${component}-${tc.name}.png` under BASELINE_DIR.
   */
  component: string;
  /**
   * Arrange the surface into a deterministic capture state. Runs AFTER the theme is
   * applied (so it may open/seed theme-dependent UI). Returns the Locator to clip.
   */
  arrange: () => Promise<Locator>;
  /**
   * Optional element exposing a `data-theme` attribute for the strongest R9 guard
   * (in addition to the always-on root-luma / forced-colors check).
   */
  guardLocator?: Locator;
  /** Extra settle (ms) after fonts.ready, on top of the default 250ms. */
  extraSettleMs?: number;
}

export interface CaptureGoldenResult {
  pass: boolean;
  message: string;
  baselineCreated: boolean;
}

/**
 * Run the full canonical capture for one surface × one theme and compare to the
 * committed baseline. Does NOT assert — returns the result so the spec can wrap it
 * in its own `expect(...).toBe(true)` with a descriptive message (and so a missing
 * baseline on a non-update run surfaces as a thrown compareToBaseline error, not a
 * silent skip). The caller pushes the REQUIRES_UWP_REFERENCE annotation when
 * baselineCreated is true (it needs test.info(), which lives in the spec scope).
 */
export async function captureGolden(args: CaptureGoldenArgs): Promise<CaptureGoldenResult> {
  const { app, page, tc, component, arrange, guardLocator, extraSettleMs = 0 } = args;

  await applyTheme(app, page, tc);
  const target = await arrange();
  await expect(target).toBeVisible();
  await assertThemeGuard(page, tc.name, guardLocator);

  // Fonts must be ready for stable glyph metrics; then let layout/animation settle.
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(250 + extraSettleMs);

  const box = await target.boundingBox();
  if (!box) throw new Error(`${component}: target has no bounding box (not laid out)`);
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

  const baselinePath = join(BASELINE_DIR, `${component}-${tc.name}.png`);
  const result = await compareToBaseline(actual, baselinePath, `${component}-${tc.name}`, {
    createMissingBaseline: UPDATE_BASELINES,
  });

  return {
    pass: result.pass,
    message: formatDiff(`${component}-${tc.name}`, result),
    baselineCreated: result.baselineCreated,
  };
}
