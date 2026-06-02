import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import {
  TAB_SELECTORS,
  activeTabId,
  clickTab,
  expectTabCount,
  listTabs,
  middleClickTab,
  resetToSingleTab,
  seedTabs,
  tabByEditorId,
  tabOrderFromSeam,
} from './helpers/tabs';

/**
 * VERIFICATION GATE 2 — Keyboard conformance (docs/plan/03 §GATE 2, appendix §App level).
 *
 *   "Keyboard conformance: all tab shortcuts 100% pass via Playwright key-injection."
 *
 * ZERO TOLERANCE. Every app-level TAB shortcut from the keyboard appendix is
 * injected against the real Electron window and asserted to perform the correct
 * action via the tab seam (exact state) and the rendered strip (DOM).
 *
 * Shortcuts under test (appendix 10-…, §App level + §Mouse):
 *   Ctrl+N / Ctrl+T  new tab
 *   Ctrl+W           close active tab
 *   Ctrl+Tab         next tab (wraps)
 *   Ctrl+Shift+Tab   previous tab (wraps)
 *   Ctrl+1 … Ctrl+9  jump to tab index (Ctrl+9 = LAST tab, UWP semantics)
 *   F2               rename active tab (focuses rename input)
 *   middle-click     close tab (mouse, included here as a "close" conformance row)
 *
 * Authored TDD-first: RED until Lane C ships the TabStrip + the
 * window.__notepadsTest.tabs seam. Drives genuine key events, never the seam
 * mutators, so a green run proves the shortcut wiring — not the test's own setup.
 */

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

/**
 * Each test resets to a single fresh tab so cases are independent despite the
 * serial single-window driver (playwright.config workers:1). Reset goes through
 * the seam (a precondition), never Ctrl+W, so it can't mask the shortcut tests.
 */
test.beforeEach(async () => {
  await resetToSingleTab(launched.page);
});

test('Ctrl+T opens a new tab and activates it', async () => {
  const { page } = launched;
  await expectTabCount(page, 1);

  await page.keyboard.press('Control+t');

  await expectTabCount(page, 2);
  const tabs = await listTabs(page);
  const active = await activeTabId(page);
  // The newly created tab becomes active (UWP SetsView opens+selects the new set).
  expect(active).toBe(tabs[tabs.length - 1].editorId);
});

test('Ctrl+N opens a new tab (alias of Ctrl+T at app level)', async () => {
  const { page } = launched;
  await expectTabCount(page, 1);

  await page.keyboard.press('Control+n');

  await expectTabCount(page, 2);
});

test('add-tab (+) button opens a new tab (mouse path)', async () => {
  const { page } = launched;
  await expectTabCount(page, 1);

  await page.locator(TAB_SELECTORS.addTab).click({ force: true });

  await expectTabCount(page, 2);
});

test('Ctrl+W closes the active tab', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);
  await clickTab(page, ids[1]);
  expect(await activeTabId(page)).toBe(ids[1]);

  await page.keyboard.press('Control+w');

  await expectTabCount(page, 2);
  const remaining = await tabOrderFromSeam(page);
  expect(remaining).not.toContain(ids[1]);
});

test('Ctrl+Tab moves to the next tab and wraps at the end', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);
  await clickTab(page, ids[0]);

  await page.keyboard.press('Control+Tab');
  expect(await activeTabId(page)).toBe(ids[1]);

  await page.keyboard.press('Control+Tab');
  expect(await activeTabId(page)).toBe(ids[2]);

  // wrap-around: from last → first
  await page.keyboard.press('Control+Tab');
  expect(await activeTabId(page)).toBe(ids[0]);
});

test('Ctrl+Shift+Tab moves to the previous tab and wraps at the start', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);
  await clickTab(page, ids[0]);

  // wrap-around: from first → last
  await page.keyboard.press('Control+Shift+Tab');
  expect(await activeTabId(page)).toBe(ids[2]);

  await page.keyboard.press('Control+Shift+Tab');
  expect(await activeTabId(page)).toBe(ids[1]);

  await page.keyboard.press('Control+Shift+Tab');
  expect(await activeTabId(page)).toBe(ids[0]);
});

// Ctrl+1..Ctrl+8 jump to the 1-based index; Ctrl+9 jumps to the LAST tab (UWP).
for (const n of [1, 2, 3, 4, 5]) {
  test(`Ctrl+${n} jumps to tab #${n}`, async () => {
    const { page } = launched;
    const ids = await seedTabs(page, 5);
    await clickTab(page, ids[0]);

    await page.keyboard.press(`Control+${n}`);

    expect(await activeTabId(page)).toBe(ids[n - 1]);
  });
}

test('Ctrl+9 jumps to the LAST tab (UWP semantics)', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 4);
  await clickTab(page, ids[0]);

  await page.keyboard.press('Control+9');

  expect(await activeTabId(page)).toBe(ids[ids.length - 1]);
});

test('F2 enters rename mode on the active tab', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 2);
  await clickTab(page, ids[1]);

  await page.keyboard.press('F2');

  const input = page.locator(TAB_SELECTORS.renameInput);
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
});

test('middle-click closes a tab (mouse conformance)', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);

  await middleClickTab(page, ids[1]);

  await expectTabCount(page, 2);
  expect(await tabOrderFromSeam(page)).not.toContain(ids[1]);
  // The closed tab's element is gone from the DOM.
  await expect(page.locator(tabByEditorId(ids[1]))).toHaveCount(0);
});
