import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { TAB_SELECTORS, seedTabs } from './helpers/tabs';

/**
 * (+) AddTabButton visibility guard (Issue 2 regression).
 *
 * The add-tab button is always in the DOM and wired to onNewTab, but a visual
 * regression made it "disappear" (dim glyph + no idle affordance, and risk of
 * the scrollable tab list clipping it). This spec boots the REAL built Electron
 * app and asserts the + is:
 *   1. visible at rest with a single tab, and
 *   2. still visible AND fully inside the window viewport after the strip is
 *      seeded past overflow (the list scrolls, the + stays pinned, flex:0 0 auto).
 */
let launched: LaunchedApp;

test.afterAll(async () => {
  await launched?.app.close();
});

test('the (+) add-tab button is visible and within the viewport (even under tab overflow)', async () => {
  launched = await launchApp();
  const { page } = launched;

  const addBtn = page.locator(TAB_SELECTORS.addTab);

  // 1. Present + visible at rest.
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toBeInViewport();

  // 2. Seed many tabs so the tab list overflows and scrolls; the + must stay
  //    pinned, visible, and fully within the window bounds (not clipped off the
  //    right edge by the scrollable list).
  await seedTabs(page, 20);
  await expect(addBtn).toBeVisible();
  await expect(addBtn).toBeInViewport();

  const inWindow = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'add button not found' };
    const r = el.getBoundingClientRect();
    const within =
      r.width > 0 &&
      r.height > 0 &&
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= window.innerWidth + 0.5 &&
      r.bottom <= window.innerHeight + 0.5;
    return {
      ok: within,
      rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  }, TAB_SELECTORS.addTab);
  expect(
    inWindow.ok,
    `add button must be fully within the window: ${JSON.stringify(inWindow)}`,
  ).toBe(true);
});
