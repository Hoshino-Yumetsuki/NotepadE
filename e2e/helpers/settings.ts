import { expect, type Page, type ElectronApplication } from '@playwright/test';
import type { Settings } from '../../src/shared/ipc-contract';

/**
 * Settings-surface e2e driver (Gate-5 harness, lane-h).
 *
 * Thin, typed wrappers so the persistence / live-theme / golden suites read as
 * behavioral assertions rather than selector soup. Two access paths, mirroring
 * helpers/tabs.ts:
 *   - DOM:  data-testid selectors from the SettingsSurface contract (lane-c).
 *           Used to OPEN the surface, navigate panes, and capture the golden.
 *   - SEAM: window.__notepadsTest.settings (PA-8-clean) for exact state reads —
 *           the resolved theme bucket + a single persisted setting value — without
 *           scraping Fluent's control internals.
 *
 * Writes go through the FROZEN contract window.notepads.settings.set(): that is
 * the genuine persist+broadcast path the panes themselves call (via useSettings),
 * and it is the only renderer-callable mutator the seam does not duplicate. The
 * UI controls that DO expose a stable testid are driven directly where a spec
 * asserts the click path; settings whose Fluent control has no inner testid
 * (Switch / RadioGroup) are driven through set() — both land in the same MAIN
 * store and broadcast back via onChanged, so the live-affect + persistence
 * assertions are identical regardless of the entry point.
 *
 * All selectors are centralized here so a contract change touches one file.
 */

export const SETTINGS_SELECTORS = {
  /** Hamburger MainMenu button, left of the tab strip (mouse entry point). */
  menuButton: '[data-testid="main-menu-button"]',
  /** The "Settings" item inside the hamburger MenuFlyout (mouse entry point). */
  open: '[data-testid="open-settings"]',
  /** The right-side overlay pane hosting the nav + panes. */
  surface: '[data-testid="settings-surface"]',
  close: '[data-testid="settings-close"]',
  nav: '[data-testid="settings-nav"]',
  // Pane scroll containers (data-testid="settings-pane-{id}").
  paneTextEditor: '[data-testid="settings-pane-textEditor"]',
  panePersonalization: '[data-testid="settings-pane-personalization"]',
  paneAdvanced: '[data-testid="settings-pane-advanced"]',
  paneAbout: '[data-testid="settings-pane-about"]',
  // App-shell surface that live-affects: the Phase-4 status bar.
  statusBar: '[data-testid="status-bar"]'
} as const;

/** Nav item selector for a section id. */
export function navItem(section: 'textEditor' | 'personalization' | 'advanced' | 'about'): string {
  return `[data-testid="settings-nav-${section}"]`;
}

/**
 * Open the settings surface via the REAL mouse path: click the hamburger MainMenu
 * button (left of the tab strip), then the "Settings" item in the flyout. Mirrors
 * the UWP MainMenuButton → MenuFlyout → Settings flow.
 */
export async function openSettings(page: Page): Promise<void> {
  await page.locator(SETTINGS_SELECTORS.menuButton).click({ force: true });
  await page.locator(SETTINGS_SELECTORS.open).click({ force: true });
  await expect(page.locator(SETTINGS_SELECTORS.surface)).toBeVisible();
}

/** Open the settings surface via the seam (the same setState the gear/Ctrl+, drive). */
export async function openSettingsViaSeam(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.__notepadsTest?.settings;
    if (!s) throw new Error('window.__notepadsTest.settings not installed (lane-c seam missing).');
    s.openSettings();
  });
  await expect(page.locator(SETTINGS_SELECTORS.surface)).toBeVisible();
}

/** Close the settings surface via the seam. */
export async function closeSettings(page: Page): Promise<void> {
  await page.evaluate(() => window.__notepadsTest?.settings?.closeSettings());
  await expect(page.locator(SETTINGS_SELECTORS.surface)).toBeHidden();
}

/**
 * Prepare the settings DialogSurface for a deterministic golden capture by forcing
 * it to full opacity. Fluent v9 animates the dialog open via the WAAPI with the
 * surface's BASE opacity pinned at 0; under Electron the open keyframe's fill does
 * NOT reliably resolve to opacity 1 unless a re-render/reflow nudges it, so a fixed
 * wait can screenshot a still-transparent (blank) dialog — that produced a ~6KB
 * "blank" golden. Rather than gate on an unreliable computed value, we pin the
 * surface opaque with a test-only inline style (the visual content underneath is
 * already mounted), making the capture independent of the open-motion timing. This
 * is capture tooling only; it does not touch app code or the contract.
 */
export async function forceSurfaceOpaqueForCapture(page: Page): Promise<void> {
  const surface = page.locator(SETTINGS_SELECTORS.surface);
  await expect(surface).toBeVisible();
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('transform', 'none', 'important');
    }
  }, SETTINGS_SELECTORS.surface);
  await expect
    .poll(() =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? Number(getComputedStyle(el).opacity) : 0;
      }, SETTINGS_SELECTORS.surface)
    )
    .toBeGreaterThanOrEqual(1);
}

/**
 * Select a settings nav section (real click) and assert its pane mounted. The
 * Fluent Dialog opens with base opacity 0 and the WAAPI open fill does not reliably
 * resolve to 1 under Electron, which leaves the NavItem non-hit-testable so a nav
 * click is dropped (the target pane never mounts). Pinning the surface opaque first
 * (content is already mounted) makes the genuine nav click land deterministically.
 */
export async function selectPane(
  page: Page,
  section: 'textEditor' | 'personalization' | 'advanced' | 'about'
): Promise<void> {
  await forceSurfaceOpaqueForCapture(page);
  await page.locator(navItem(section)).click({ force: true });
  await expect(page.locator(`[data-testid="settings-pane-${section}"]`)).toBeVisible();
}

/**
 * Read one persisted setting through the seam (the live MAIN-owned bag the UI
 * renders from — the source of truth for a live-affect / persistence assertion).
 */
export async function getSetting<K extends keyof Settings>(
  page: Page,
  key: K
): Promise<Settings[K]> {
  return page.evaluate((k) => {
    const s = window.__notepadsTest?.settings;
    if (!s) throw new Error('window.__notepadsTest.settings not installed (lane-c seam missing).');
    return s.getSetting(k as keyof Settings) as unknown;
  }, key) as Promise<Settings[K]>;
}

/** The resolved theme bucket the FluentProvider is using ('light'|'dark'|'hc'). */
export async function getActiveTheme(page: Page): Promise<'light' | 'dark' | 'hc'> {
  return page.evaluate(() => {
    const s = window.__notepadsTest?.settings;
    if (!s) throw new Error('window.__notepadsTest.settings not installed (lane-c seam missing).');
    return s.getActiveTheme();
  });
}

/**
 * Patch settings through the FROZEN contract (window.notepads.settings.set) — the
 * genuine persist+broadcast path the panes call via useSettings. Returns once
 * MAIN's merged bag has been awaited so the change is on disk before the caller
 * relaunches. Throws on an !ok result so a broken MAIN store fails loudly.
 */
export async function patchSettings(page: Page, patch: Partial<Settings>): Promise<void> {
  const res = await page.evaluate(
    (p) => window.notepads.settings.set(p as Partial<Settings>),
    patch
  );
  if (!res.ok) throw new Error(`settings.set failed: ${res.error}`);
}

/**
 * Wait until the seam reports `key` equals `expected` — settles the optimistic
 * local apply → MAIN persist → onChanged reconcile round-trip so a live-affect
 * assertion never races the broadcast.
 */
export async function expectSetting<K extends keyof Settings>(
  page: Page,
  key: K,
  expected: Settings[K]
): Promise<void> {
  await expect
    .poll(async () => getSetting(page, key), {
      message: `setting ${String(key)} = ${String(expected)}`
    })
    .toEqual(expected);
}

/**
 * Read the app-shell root surface background color as a luminance band. This is
 * the R9 guard anchor: App.tsx paints the FluentProvider root
 * `backgroundColor: tokensForAppTheme(resolved).base` (light #F0F0F0 ≈ 240,
 * dark #2E2E2E ≈ 46), so a theme-read regression that silently stays light shows
 * up as a luma > 180 in the dark/hc case BEFORE any pixel diff.
 */
export async function rootSurfaceLuma(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector('.fui-FluentProvider') ?? document.body;
    const m = getComputedStyle(root as Element).backgroundColor.match(/\d+/g);
    if (!m) return -1;
    const [r, g, b] = m.map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  });
}

/**
 * Read the resolved Fluent brand background token (--colorBrandBackground) off the
 * settings surface. The brand ramp is generated from the active accent (shade 80 =
 * seed), so a live accent change moves this token — the observable reflection a
 * theme/accent-read regression would break.
 */
export async function brandBackground(page: Page): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue('--colorBrandBackground').trim();
  }, SETTINGS_SELECTORS.surface);
}

/**
 * Drive the OS theme by setting Electron's `nativeTheme.themeSource` in the MAIN
 * process — the genuine system-theme signal. This fires nativeTheme's 'updated'
 * event, which src/main/theme.ts broadcasts as EvtThemeOsChanged, which
 * useAppTheme consumes via window.notepads.theme.onOsThemeChanged → the resolved
 * bucket re-computes with NO reload.
 *
 * This is THE nativeTheme seam the Gate-5 brief calls for. emulateMedia cannot be
 * used for the light/dark OS flip here: MAIN owns the OS theme via nativeTheme and
 * the renderer never reads prefers-color-scheme for it (PA-8), so the renderer's
 * emulated media query is overridden by MAIN's authoritative push. Forced-colors
 * (high contrast) is still driven via emulateMedia because useAppTheme folds the
 * renderer forced-colors media query directly into the bucket.
 */
export async function driveOsTheme(
  app: ElectronApplication,
  theme: 'light' | 'dark'
): Promise<void> {
  await app.evaluate(({ nativeTheme }, t) => {
    nativeTheme.themeSource = t;
  }, theme);
}

/** Reset nativeTheme back to following the host OS (test teardown hygiene). */
export async function resetOsTheme(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
}
