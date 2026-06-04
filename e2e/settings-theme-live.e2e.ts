import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import {
  openSettings,
  selectPane,
  patchSettings,
  getActiveTheme,
  rootSurfaceLuma,
  brandBackground,
} from './helpers/settings';

/**
 * VERIFICATION GATE 5 — line 2: live theme + accent (docs/plan/05 §GATE 5).
 *
 *   "Drive nativeTheme via the test seam or emulateMedia; assert FluentProvider
 *    resolved theme flips light↔dark↔hc WITHOUT page.reload(); assert accent
 *    change reflected."
 *
 * useAppTheme resolves the bucket from settings.themeMode + the OS theme + the
 * forced-colors media query, recomputing on every signal with NO reload. With the
 * default themeMode='system', emulateMedia({ colorScheme }) drives the OS-theme
 * input and emulateMedia({ forcedColors:'active' }) drives high-contrast, so the
 * resolved bucket (window.__notepadsTest.settings.getActiveTheme()) must flip
 * light↔dark↔hc live. Accent is driven through the genuine settings path
 * (useWindowsAccentColor=false + a custom #RRGGBB), which re-seeds the brand ramp
 * and moves the FluentProvider --colorBrandBackground token.
 *
 * R9 GUARD (docs/plan/11 risk R9): the renderer drives themes WITHOUT a reload, so
 * a regression to mount-only theme reading would silently keep the all-light
 * "false green" a pixel baseline can't catch. BEFORE trusting getActiveTheme, this
 * spec asserts the ACTUAL rendered root surface luminance matches the emulated
 * theme, so a theme-read regression fails LOUDLY here.
 */

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

test.describe('Gate 5 — live theme + accent (no reload)', () => {
  test.beforeEach(async () => {
    // Start each case from a known input: 'system' mode so the OS theme decides,
    // light scheme, no forced-colors. This is the default bag but reset explicitly
    // so a prior case can't leak its emulateMedia / themeMode into this one.
    await patchSettings(launched.page, { themeMode: 'system', useWindowsAccentColor: true });
    await launched.page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
  });

  test('OS theme light↔dark↔hc flips the resolved bucket live, with the R9 surface guard', async () => {
    const { page } = launched;

    // --- light ---
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    // R9: the rendered root surface must actually be light (luma ≈ 240) — assert
    // BEFORE believing the seam, so a theme-read regression can't pass silently.
    expect(await rootSurfaceLuma(page), 'light root surface luminance').toBeGreaterThan(180);

    // --- dark (flip WITHOUT a reload) ---
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' });
    await expect
      .poll(() => getActiveTheme(page))
      .toBe('dark'); // reactive recompute, no page.reload()
    expect(
      await rootSurfaceLuma(page),
      'dark root surface luminance (>180 means the theme read regressed to light)',
    ).toBeLessThan(120);

    // --- hc (forced-colors wins over colorScheme) ---
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
    await expect.poll(() => getActiveTheme(page)).toBe('hc');
    const forcedActive = await page.evaluate(
      () => window.matchMedia('(forced-colors: active)').matches,
    );
    expect(forcedActive, 'HC requires forced-colors: active to be live').toBe(true);

    // --- back to light, proving the transition is genuinely bidirectional ---
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    expect(await rootSurfaceLuma(page), 'light again after hc').toBeGreaterThan(180);
  });

  test('themeMode override pins the bucket regardless of the OS theme (live, no reload)', async () => {
    const { page } = launched;

    // Force dark while the OS reports light: the explicit override must win live.
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'none' });
    await patchSettings(page, { themeMode: 'dark' });
    await expect.poll(() => getActiveTheme(page)).toBe('dark');
    expect(await rootSurfaceLuma(page), 'forced-dark over light OS').toBeLessThan(120);

    // Force light while the OS reports dark.
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' });
    await patchSettings(page, { themeMode: 'light' });
    await expect.poll(() => getActiveTheme(page)).toBe('light');
    expect(await rootSurfaceLuma(page), 'forced-light over dark OS').toBeGreaterThan(180);
  });

  test('a custom accent re-seeds the brand ramp live — the brand token moves', async () => {
    const { page } = launched;

    // Render the settings surface (the brand token is read off its FluentProvider).
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' });
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
