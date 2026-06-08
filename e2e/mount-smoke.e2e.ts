import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';

/**
 * Mount smoke (regression guard).
 *
 * Boots the REAL Electron app and asserts the renderer actually mounts — the app
 * shell, tab strip, hamburger menu, and a CodeMirror editor are all present, and
 * NO uncaught page error fired during mount.
 *
 * Why this exists: a runtime throw in a leaf component (e.g. an invalid CodeMirror
 * `EditorView.theme` selector) unmounts the whole React tree with no error
 * boundary, leaving only the window background. typecheck, unit tests, and even a
 * successful `vite build` all pass in that case because none of them construct the
 * real themed EditorView under Electron. This test does, so the class of
 * "blank UI on boot" bug is caught before it ships.
 */
let launched: LaunchedApp;

test.afterAll(async () => {
  await launched?.app.close();
});

test('app mounts: shell + tab strip + editor render with no page error', async () => {
  const pageErrors: string[] = [];

  launched = await launchApp();
  const { page } = launched;
  page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));

  // The real chrome must be present (these are absent when the tree unmounts).
  await expect(page.locator('[data-testid="tab-strip"]')).toBeVisible();
  await expect(page.locator('[data-testid="main-menu-button"]')).toBeVisible();
  await expect(page.locator('.cm-editor')).toBeVisible();

  // Custom caption controls (Windows frameless): the min/max/close cluster
  // replaces the OS titleBarOverlay, so it must actually mount + be wired. On
  // non-Windows the native frame draws them and the slot is absent — assert
  // conditionally on the real platform.
  if (process.platform === 'win32') {
    await expect(page.locator('[data-testid="caption-minimize"]')).toBeVisible();
    await expect(page.locator('[data-testid="caption-maximize"]')).toBeVisible();
    await expect(page.locator('[data-testid="caption-close"]')).toBeVisible();
    // Maximize toggle round-trips through MAIN and reflects back on the glyph
    // (aria-label flips Maximize→Restore). Proves the IPC chain + onMaximizeChanged.
    const maxBtn = page.locator('[data-testid="caption-maximize"]');
    const before = await maxBtn.getAttribute('aria-label');
    await maxBtn.click();
    await expect(maxBtn).not.toHaveAttribute('aria-label', before ?? '');
    // Restore so the window state is clean for any later spec sharing the app.
    await maxBtn.click();
  }

  const mounted = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      rootChildCount: root?.childElementCount ?? -1,
      hasFluentProvider: !!document.querySelector('.fui-FluentProvider'),
      hasAppShell: !!document.querySelector('#app-shell')
    };
  });
  expect(mounted.rootChildCount).toBeGreaterThan(0);
  expect(mounted.hasFluentProvider).toBe(true);
  expect(mounted.hasAppShell).toBe(true);

  // No uncaught error may have fired during mount.
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
});
