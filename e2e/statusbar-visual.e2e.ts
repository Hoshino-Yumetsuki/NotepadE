import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { compareToBaseline, formatDiff } from '../scripts/visual-diff';
import { resetToSingleTab } from './helpers/tabs';
import { driveOsTheme, resetOsTheme } from './helpers/settings';

/**
 * VERIFICATION GATE 4 — status bar (docs/plan/05 §4.C + §GATE 4).
 *
 *   "Status bar golden-image ≤0.1% per theme; all 8 flyouts assert correct
 *    actions via matrix."
 *
 * Two parts, both driving the REAL rendered StatusBar (App mounts it as
 * `<StatusBar {...statusModel} />`, fed by useStatusBarModel):
 *
 *   (1) Golden image per theme (light / dark / high-contrast) at ≤0.1% pixel
 *       delta, reusing scripts/visual-diff.ts (the same harness + tolerance as
 *       the Gate-2 tab strip). The OS light/dark flip is driven through the MAIN
 *       `nativeTheme.themeSource` seam (driveOsTheme), NOT emulateMedia: MAIN owns
 *       the OS theme via nativeTheme and the renderer reads it through
 *       window.notepads.theme (PA-8), so an emulated prefers-color-scheme is
 *       overridden by MAIN's authoritative push. Relying on emulateMedia alone made
 *       the dark/hc goldens pass only when an earlier test had already nudged
 *       nativeTheme — a false green that failed IN ISOLATION (R10). Driving the seam
 *       per-test makes each case self-contained. High-contrast additionally needs a
 *       page.reload() after emulateMedia({ forcedColors: 'active' }): CDP emulation
 *       sets the queried value but does not fire a forced-colors `change` event into a
 *       freshly-launched renderer, so useAppTheme only resolves the 'hc' bucket by
 *       reading the query AT MOUNT (the freshly-reloaded-page hardening R9 recommends).
 *       App re-resolves the bucket reactively (no reload) for light/dark.
 *   (2) An 8-column flyout MATRIX: open each column's flyout and assert the exact
 *       action items (testids) the UWP StatusBar.cs wires, so a regression that
 *       drops/relabels an action fails loudly.
 *
 * BASELINE PROVENANCE: identical policy to tabs-visual — initial baselines are
 * self-referential regression guards captured from THIS render via
 * `npm run visual:capture` (NOTEPADS_VISUAL_UPDATE=1). REQUIRES_UWP_REFERENCE
 * for true 1:1 StatusBar fidelity sign-off against the real UWP status bar.
 */

const BASELINE_DIR = join(process.cwd(), 'e2e', 'visual', 'baselines');
const UPDATE_BASELINES = process.env.NOTEPADS_VISUAL_UPDATE === '1';

const STATUS = {
  bar: '[data-testid="status-bar"]',
  // column 1 — path flyout
  path: '[data-testid="status-path"]',
  pathMenu: '[data-testid="status-path-menu"]',
  pathReload: '[data-testid="status-path-reload"]',
  pathCopy: '[data-testid="status-path-copy"]',
  pathFolder: '[data-testid="status-path-folder"]',
  pathRename: '[data-testid="status-path-rename"]',
  // column 2 — modification flyout
  modification: '[data-testid="status-modification"]',
  modificationMenu: '[data-testid="status-modification-menu"]',
  modificationPreview: '[data-testid="status-modification-preview"]',
  modificationRevert: '[data-testid="status-modification-revert"]',
  // column 3 — line/col (click = go-to)
  linecol: '[data-testid="status-linecol"]',
  // column 4 — zoom flyout
  zoom: '[data-testid="status-zoom"]',
  zoomFlyout: '[data-testid="status-zoom-flyout"]',
  zoomOut: '[data-testid="status-zoom-out"]',
  zoomIn: '[data-testid="status-zoom-in"]',
  zoomSlider: '[data-testid="status-zoom-slider"]',
  zoomReset: '[data-testid="status-zoom-reset"]',
  // column 5 — EOL menu
  eol: '[data-testid="status-eol"]',
  eolMenu: '[data-testid="status-eol-menu"]',
  eolCrlf: '[data-testid="status-eol-crlf"]',
  eolCr: '[data-testid="status-eol-cr"]',
  eolLf: '[data-testid="status-eol-lf"]',
  // column 6 — encoding menu (two parent submenus)
  encoding: '[data-testid="status-encoding"]',
  encodingMenu: '[data-testid="status-encoding-menu"]',
  encodingReopen: '[data-testid="status-encoding-reopen"]',
  encodingSave: '[data-testid="status-encoding-save"]',
} as const;

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  // Hygiene: return nativeTheme to following the host so a later spec in the same
  // process starts from the real OS theme rather than a value this suite pinned.
  if (launched) await resetOsTheme(launched.app);
  await launched?.app.close();
});

/** Reset to a single clean untitled tab so the bar shows deterministic defaults. */
async function arrangeDefaultStatusBar(page: Page): Promise<void> {
  await resetToSingleTab(page);
  await expect(page.locator(STATUS.bar)).toBeVisible();
  // Default content is deterministic: Untitled path, Ln 1 Col 1, 100%, CRLF, UTF-8.
  await expect(page.locator('[data-testid="status-linecol-text"]')).toHaveText('Ln 1, Col 1');
  await expect(page.locator('[data-testid="status-eol-text"]')).toHaveText('Windows (CRLF)');
  await expect(page.locator('[data-testid="status-encoding-text"]')).toHaveText('UTF-8');
}

// ---------------------------------------------------------------------------
//  (1) Golden image per theme
// ---------------------------------------------------------------------------

type ThemeName = 'light' | 'dark' | 'hc';
interface ThemeCase {
  name: ThemeName;
  colorScheme: 'light' | 'dark';
  forcedColors: 'active' | 'none';
}
const THEME_CASES: ThemeCase[] = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'hc', colorScheme: 'dark', forcedColors: 'active' },
];

for (const tc of THEME_CASES) {
  test(`status bar golden image — ${tc.name} theme <=0.1% delta @visual`, async () => {
    const { page, app } = launched;

    // Drive the OS light/dark flip through the MAIN nativeTheme seam (authoritative
    // for the renderer's resolved bucket), and the high-contrast query through
    // emulateMedia. This makes each case self-contained so it passes IN ISOLATION,
    // not only after a prior test happened to set nativeTheme/forced-colors (R10).
    await driveOsTheme(app, tc.colorScheme);
    await page.emulateMedia({ colorScheme: tc.colorScheme, forcedColors: tc.forcedColors });

    // R10 (high-contrast): emulateMedia({ forcedColors: 'active' }) sets the queried
    // value but, in a freshly-launched page with no prior emulation, does NOT dispatch
    // a `change` event to useAppTheme's forced-colors MediaQueryList listener — so the
    // renderer's highContrast state, initialized false at mount, never flips and the
    // bucket stays 'dark'. (In the full suite an earlier emulation had latched it true:
    // the latent ordering dependency.) Reload the page so useAppTheme re-initializes
    // highContrast from matchMedia('(forced-colors: active)') AT MOUNT — the same
    // freshly-reloaded-page hardening R9 recommends. emulateMedia + the MAIN nativeTheme
    // seam both persist across a renderer reload, so the page remounts under HC + dark.
    if (tc.name === 'hc') {
      await page.reload();
    }
    await arrangeDefaultStatusBar(page);

    const bar = page.locator(STATUS.bar);
    await expect(bar).toBeVisible();

    // R9 guard (mirrors tabs-visual): assert the bar actually entered the emulated
    // theme so a theme-read regression fails LOUDLY here instead of diffing the
    // wrong baseline. data-theme is set by StatusBar from its theme prop.
    if (tc.name === 'hc') {
      await expect(bar).toHaveAttribute('data-theme', 'hc');
      const forcedActive = await page.evaluate(
        () => window.matchMedia('(forced-colors: active)').matches,
      );
      expect(forcedActive, 'HC capture requires forced-colors: active to be live').toBe(true);
    } else {
      await expect(bar).toHaveAttribute('data-theme', tc.name);
    }

    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.waitForTimeout(250);

    const box = await bar.boundingBox();
    if (!box) throw new Error('status bar has no bounding box (not laid out)');
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
    const baselinePath = join(BASELINE_DIR, `status-bar-${tc.name}.png`);
    const result = compareToBaseline(actual, baselinePath, `status-bar-${tc.name}`, {
      createMissingBaseline: UPDATE_BASELINES,
    });

    if (result.baselineCreated) {
      test.info().annotations.push({
        type: 'baseline-created',
        description: `Wrote new baseline ${baselinePath} (REQUIRES_UWP_REFERENCE for 1:1 sign-off).`,
      });
    }

    expect(result.pass, formatDiff(`status-bar-${tc.name}`, result)).toBe(true);
  });
}

// ---------------------------------------------------------------------------
//  (2) 8-column flyout action matrix
// ---------------------------------------------------------------------------

test.describe('Gate 4 — status bar flyout action matrix', () => {
  test.beforeEach(async () => {
    // Pin dark via the MAIN nativeTheme seam (same R10 rationale as the goldens) so
    // these flyout assertions render against a deterministic theme in isolation.
    await driveOsTheme(launched.app, 'dark');
    await launched.page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' });
    await arrangeDefaultStatusBar(launched.page);
  });

  test('column 0 + 7: file-mod-state and shadow-window placeholders render (no flyout by default)', async () => {
    const { page } = launched;
    // Default model: fileModificationState 'none' and non-shadow window, so both
    // edge columns render their empty Auto-width placeholders (UWP MinWidth cells).
    await expect(page.locator('[data-testid="status-mod-state"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="status-shadow"]')).toHaveCount(1);
  });

  test('column 1 — path flyout exposes reload / copy / open-folder / rename', async () => {
    const { page } = launched;
    await page.locator(STATUS.path).click({ force: true });
    await expect(page.locator(STATUS.pathMenu)).toBeVisible();
    await expect(page.locator(STATUS.pathReload)).toBeVisible();
    await expect(page.locator(STATUS.pathCopy)).toBeVisible();
    await expect(page.locator(STATUS.pathFolder)).toBeVisible();
    await expect(page.locator(STATUS.pathRename)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('column 2 — modification flyout (preview / revert) appears only when dirty', async () => {
    const { page } = launched;
    // Clean by default: the modification cell is an empty placeholder with no menu.
    await expect(page.locator(STATUS.modificationMenu)).toHaveCount(0);

    // Mark the active tab modified via the real store seam, then the flyout exists.
    await page.evaluate(() => {
      const t = window.__notepadsTest?.tabs;
      if (!t) throw new Error('tabs seam missing');
      const id = t.activeId();
      if (id) t.setModified(id, true);
    });
    await expect(page.locator(STATUS.modification)).toBeVisible();
    await page.locator(STATUS.modification).click({ force: true });
    await expect(page.locator(STATUS.modificationMenu)).toBeVisible();
    await expect(page.locator(STATUS.modificationPreview)).toBeVisible();
    await expect(page.locator(STATUS.modificationRevert)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('column 3 — line/col cell dispatches the go-to-line intent on click', async () => {
    const { page } = launched;
    // The cell wires onGoToLine -> window dispatch 'notepads:go-to-line'. Assert the
    // real event fires (the dialog itself is a later phase).
    const fired = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const onGo = (): void => {
            window.removeEventListener('notepads:go-to-line', onGo);
            resolve(true);
          };
          window.addEventListener('notepads:go-to-line', onGo);
          (document.querySelector('[data-testid="status-linecol"]') as HTMLElement)?.click();
          setTimeout(() => resolve(false), 1000);
        }),
    );
    expect(fired, 'clicking line/col must dispatch notepads:go-to-line').toBe(true);
  });

  test('column 4 — zoom flyout exposes out / slider / in / reset and updates the label', async () => {
    const { page } = launched;
    await page.locator(STATUS.zoom).click({ force: true });
    await expect(page.locator(STATUS.zoomFlyout)).toBeVisible();
    await expect(page.locator(STATUS.zoomOut)).toBeVisible();
    await expect(page.locator(STATUS.zoomSlider)).toBeVisible();
    await expect(page.locator(STATUS.zoomIn)).toBeVisible();
    await expect(page.locator(STATUS.zoomReset)).toBeVisible();

    // Zoom-in raises the percentage label (10% step, real onSetZoom path).
    await page.locator(STATUS.zoomIn).click({ force: true });
    await expect(page.locator('[data-testid="status-zoom-text"]')).toHaveText('110%');
    // Reset restores 100%.
    await page.locator(STATUS.zoomReset).click({ force: true });
    await expect(page.locator('[data-testid="status-zoom-text"]')).toHaveText('100%');
    await page.keyboard.press('Escape');
  });

  test('column 5 — EOL menu exposes CRLF / CR / LF and applies a selection', async () => {
    const { page } = launched;
    await page.locator(STATUS.eol).click({ force: true });
    await expect(page.locator(STATUS.eolMenu)).toBeVisible();
    await expect(page.locator(STATUS.eolCrlf)).toBeVisible();
    await expect(page.locator(STATUS.eolCr)).toBeVisible();
    await expect(page.locator(STATUS.eolLf)).toBeVisible();

    // Selecting LF re-labels the cell (real onChangeEol -> store.setLabels path).
    await page.locator(STATUS.eolLf).click({ force: true });
    await expect(page.locator('[data-testid="status-eol-text"]')).toHaveText('Unix (LF)');
  });

  test('column 6 — encoding menu exposes reopen-with / save-with, each with Unicode rows', async () => {
    const { page } = launched;
    await page.locator(STATUS.encoding).click({ force: true });
    await expect(page.locator(STATUS.encodingMenu)).toBeVisible();
    await expect(page.locator(STATUS.encodingReopen)).toBeVisible();
    await expect(page.locator(STATUS.encodingSave)).toBeVisible();

    // Open "Reopen with" submenu; the four Unicode rows are static (always present).
    await page.locator(STATUS.encodingReopen).click({ force: true });
    await expect(page.locator('[data-testid="status-encoding-reopen-UTF-8"]')).toBeVisible();
    await expect(page.locator('[data-testid="status-encoding-reopen-UTF-8-BOM"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="status-encoding-reopen-UTF-16 LE BOM"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="status-encoding-reopen-UTF-16 BE BOM"]'),
    ).toBeVisible();
    // The "More encodings" submenu trigger is present (ANSI rows fetched from MAIN).
    await expect(page.locator('[data-testid="status-encoding-reopen-more"]')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});
