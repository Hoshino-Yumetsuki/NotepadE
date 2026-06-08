import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { TAB_SELECTORS, clickAddTab, seedTabs, activeTabId } from './helpers/tabs';

/**
 * Active-tab visibility under overflow (two reported bugs).
 *
 * Bug 1: with many tabs, clicking (+) selects the new tab but the horizontal
 *        scroll did NOT follow it — the active tab stayed off-screen.
 * Bug 2: selecting a tab then scrolling it out of view left its elevation overlay
 *        (the selected-tab "merge" shadow/translucent block) pinned over the
 *        hamburger/scroll chrome instead of vanishing.
 *
 * Boots the REAL built Electron app (the geometry only exists with a layout
 * engine; the pure clamp/scroll math is unit-tested in tabScroll.test.ts).
 */
let launched: LaunchedApp;

test.afterAll(async () => {
  await launched?.app.close();
});

test('clicking (+) under overflow scrolls the new active tab fully into view (Bug 1)', async () => {
  launched = await launchApp();
  const { page } = launched;

  // Overflow the strip so the list scrolls internally.
  await seedTabs(page, 25);

  // Click the REAL (+) button a few more times — each adds + activates a tab at
  // the far right, past the visible viewport.
  for (let i = 0; i < 4; i++) await clickAddTab(page);

  const activeId = await activeTabId(page);
  expect(activeId).not.toBeNull();

  // The active tab must be fully inside the tab-LIST viewport (the scroll
  // followed the selection).
  const vis = await page.evaluate(
    ({ listSel, activeSel }) => {
      const list = document.querySelector(listSel);
      const active = document.querySelector(activeSel);
      if (!list || !active) return { ok: false, reason: 'list or active tab missing' };
      const lb = list.getBoundingClientRect();
      const tb = active.getBoundingClientRect();
      const fullyVisible = tb.left >= lb.left - 0.5 && tb.right <= lb.right + 0.5;
      return { ok: fullyVisible, lb: { l: lb.left, r: lb.right }, tb: { l: tb.left, r: tb.right } };
    },
    { listSel: TAB_SELECTORS.tabList, activeSel: '[data-testid="tab"][data-active="true"]' }
  );
  expect(vis.ok, `active tab must be fully within the list viewport: ${JSON.stringify(vis)}`).toBe(
    true
  );
});

test('scrolling a selected tab out of view does not leak its elevation over the chrome (Bug 2)', async () => {
  const { page } = launched;

  // Select the FIRST tab, then scroll the list fully to the right so tab #1 is
  // pushed off the list's left edge (under the hamburger / scroll-left chrome).
  const firstId = await page.evaluate(() => {
    const t = window.__notepadsTest?.tabs;
    const list = t?.list() ?? [];
    if (list.length > 0) t?.activate(list[0].editorId);
    return list[0]?.editorId ?? null;
  });
  expect(firstId).not.toBeNull();

  await page.evaluate((listSel) => {
    const list = document.querySelector(listSel) as HTMLElement | null;
    if (list) list.scrollLeft = list.scrollWidth; // hard right
  }, '[data-testid="tab-list"]');

  // Give the measure rAF a tick to recompute the overlay.
  await page.waitForTimeout(100);

  // The elevation overlay (data-testid="tab-elevation") must either not exist or
  // sit entirely within the list viewport — never spilling left over the chrome.
  const leak = await page.evaluate(
    ({ listSel, elevSel }) => {
      const list = document.querySelector(listSel);
      const elev = document.querySelector(elevSel);
      if (!list) return { ok: false, reason: 'list missing' };
      if (!elev) return { ok: true, reason: 'no overlay (acceptable — vanished)' };
      const lb = list.getBoundingClientRect();
      const eb = elev.getBoundingClientRect();
      // Overlay must not extend left of the list's left edge.
      const within = eb.left >= lb.left - 0.5 && eb.right <= lb.right + 0.5;
      return { ok: within, lb: { l: lb.left, r: lb.right }, eb: { l: eb.left, r: eb.right } };
    },
    { listSel: '[data-testid="tab-list"]', elevSel: '[data-testid="tab-elevation"]' }
  );
  expect(
    leak.ok,
    `selected-tab elevation must not leak over the chrome: ${JSON.stringify(leak)}`
  ).toBe(true);
});
