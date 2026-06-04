import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import {
  openSettings,
  selectPane,
  patchSettings,
  getActiveTheme,
  rootSurfaceLuma,
  brandBackground,
  driveOsTheme,
  resetOsTheme,
} from './helpers/settings';

/**
 * VERIFICATION GATE 5 — line 2: live theme + accent (docs/plan/05 §GATE 5).
 *
 *   "Drive nativeTheme via the test seam or emulateMedia; assert FluentProvider
 *    resolved theme flips light↔dark↔hc WITHOUT page.reload(); assert accent
 *    change reflected."
 *
 * useAppTheme resolves the bucket from settings.themeMode + the OS theme + the
 * forced-colors media query, recomputing on every signal with NO reload.
 *
 * OS theme (light↔dark) is driven through the NATIVETHEME SEAM: the test sets
 * Electron's nativeTheme.themeSource in MAIN (helpers/driveOsTheme), which fires
 * nativeTheme's 'updated' event → src/main/theme.ts broadcasts EvtThemeOsChanged →
 * useAppTheme's window.notepads.theme.onOsThemeChanged updates osTheme → the bucket
 * re-resolves. This is the genuine production OS-theme path. emulateMedia is NOT
 * used for light/dark: MAIN owns the OS theme via nativeTheme and the renderer
 * never reads prefers-color-scheme for it (PA-8), so MAIN's push overrides any
 * emulated renderer media query. High-contrast IS driven via emulateMedia
 * (forcedColors), because useAppTheme folds the renderer forced-colors media query
 * directly into the bucket.
 *
 * R9 GUARD (docs/plan/11 risk R9): the renderer re-themes WITHOUT a reload, so a
 * regression to mount-only theme reading would silently keep the all-light "false
 * green" a pixel baseline can't catch. BEFORE trusting getActiveTheme, this spec
 * asserts the ACTUAL rendered root surface luminance matches the target theme, so a
 * theme-read regression fails LOUDLY here.
 */

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  // Wide viewport so the 880px settings dialog (accent test) fits on-screen.
  await launched.page.setViewportSize({ width: 1280, height: 800 });
});

test.afterAll(async () => {
  await launched?.app.close();
});

test.describe('Gate 5 — live theme + accent (no reload)', () => {
  test.beforeEach(async () => {
    // Reset to a known input each case: 'system' mode + OS light + no forced-colors,
    // so a prior case can't leak its themeMode / nativeTheme / forcedColors here.
    await patchSettings(launched.page, { themeMode: 'system', useWindowsAccentColor: true });
    await launched.page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await driveOsTheme(launched.app, 'light');
  });

  test.afterEach(async () => {
    await resetOsTheme(launched.app);
  });

  test('OS theme light↔dark↔hc flips the resolved bucket live, with the R9 surface guard', async () => {
    const { page, app } = launched;

    // --- light (OS theme via the nativeTheme seam) ---
    await driveOsTheme(app, 'light');
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    // R9: the rendered root surface must actually be light (luma ≈ 240) — assert
    // BEFORE believing the seam, so a theme-read regression can't pass silently.
    expect(await rootSurfaceLuma(page), 'light root surface luminance').toBeGreaterThan(180);

    // --- dark (flip via MAIN nativeTheme push, WITHOUT a reload) ---
    await driveOsTheme(app, 'dark');
    await expect.poll(() => getActiveTheme(page)).toBe('dark'); // reactive recompute, no reload
    expect(
      await rootSurfaceLuma(page),
      'dark root surface luminance (>180 means the theme read regressed to light)',
    ).toBeLessThan(120);

    // --- hc (forced-colors wins over the OS theme) ---
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
    await expect.poll(() => getActiveTheme(page)).toBe('hc');
    const forcedActive = await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches,
    );
    expect(forcedActive, 'HC requires forced-colors: active to be live').toBe(true);

    // --- back to light, proving the transition is genuinely bidirectional ---
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await driveOsTheme(app, 'light');
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    expect(await rootSurfaceLuma(page), 'light again after hc').toBeGreaterThan(180);
  });

  test('themeMode override pins the bucket regardless of the OS theme (live, no reload)', async () => {
    const { page, app } = launched;

    // Force dark while the OS reports light: the explicit override must win live.
    await driveOsTheme(app, 'light');
    await patchSettings(page, { themeMode: 'dark' });
    await expect.poll(() => getActiveTheme(page)).toBe('dark');
    expect(await rootSurfaceLuma(page), 'forced-dark over light OS').toBeLessThan(120);

    // Force light while the OS reports dark.
    await driveOsTheme(app, 'dark');
    await patchSettings(page, { themeMode: 'light' });
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    expect(await rootSurfaceLuma(page), 'forced-light over dark OS').toBeGreaterThan(180);
  });

  test('a custom accent re-seeds the brand ramp live — the brand token moves', async () => {
    const { page } = launched;

    // Render the settings surface (the brand token is read off its FluentProvider).
    // Pin themeMode=dark so the bucket is stable while only the accent changes.
    await patchSettings(page, { themeMode: 'dark' });
    await openSettings(page);
    await selectPane(page, 'personalization');

    // Seed a known custom accent (Windows blue) and read the resolved brand token.
    await patchSettings(page, { useWindowsAccentColor: false, customAccentColor: '#0078D4' });
    await expect.poll(() => brandBackground(page)).not.toBe('');
    const blueBrand = await brandBackground(page);
    expect(blueBrand, 'brand token resolves for the blue accent').not.toBe('');

    // Switch to a clearly different accent (magenta) — the brand background token
    // must CHANGE live (no reload), proving the accent feeds the ramp reactively.
    await patchSettings(page, { customAccentColor: '#C239B3' });
    await expect.poll(() => brandBackground(page)).not.toBe(blueBrand);
    const magentaBrand = await brandBackground(page);
    expect(magentaBrand, 'magenta accent must move the brand token off the blue value').not.toBe(
      blueBrand,
    );
  });
});
