import { expect, type Page } from '@playwright/test';
import type { TabInfo } from '../types/notepads-global';

/**
 * Tab-strip e2e driver (Lane D harness).
 *
 * Thin, typed wrappers over the page so the keyboard + matrix suites read as
 * behavioral assertions rather than selector soup. Two access paths:
 *   - DOM:  data-testid selectors from the agreed TabStrip contract (see the
 *           message to tabs-builder). Used to drive the REAL UI (clicks, keys).
 *   - SEAM: window.__notepadsTest.tabs read accessors for exact state assertions
 *           (order, active id, modified flags) without scraping the DOM.
 *
 * All selectors are centralized here so a contract change touches one file.
 */

export const TAB_SELECTORS = {
  strip: '[data-testid="tab-strip"]',
  tab: '[data-testid="tab"]',
  tabTitle: '[data-testid="tab-title"]',
  tabClose: '[data-testid="tab-close"]',
  addTab: '[data-testid="tab-add"]',
  renameInput: '[data-testid="tab-rename-input"]',
  scrollLeft: '[data-testid="tab-scroll-left"]',
  scrollRight: '[data-testid="tab-scroll-right"]',
  // Context-menu items (Fluent Menu). Names mirror the UWP TabContextFlyout set.
  menuClose: '[data-testid="tab-menu-close"]',
  menuCloseOthers: '[data-testid="tab-menu-close-others"]',
  menuCloseToRight: '[data-testid="tab-menu-close-right"]',
  menuCloseSaved: '[data-testid="tab-menu-close-saved"]',
  menuCopyPath: '[data-testid="tab-menu-copy-path"]',
  menuOpenFolder: '[data-testid="tab-menu-open-folder"]',
  menuRename: '[data-testid="tab-menu-rename"]',
} as const;

/** A tab element selected by its editorId via the data-editor-id attribute. */
export function tabByEditorId(editorId: string): string {
  return `[data-testid="tab"][data-editor-id="${editorId}"]`;
}

/** Read the full tab list from the seam (exact state, source of truth). */
export async function listTabs(page: Page): Promise<TabInfo[]> {
  return page.evaluate(() => {
    const t = window.__notepadsTest?.tabs;
    if (!t) throw new Error('window.__notepadsTest.tabs not installed (Lane C tab seam missing).');
    return t.list();
  });
}

/** Read the active editorId from the seam. */
export async function activeTabId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__notepadsTest?.tabs?.activeId() ?? null);
}

/** The editorIds in current DOM order — used to assert reorder via the rendered strip. */
export async function tabOrderFromDom(page: Page): Promise<string[]> {
  return page.$$eval(TAB_SELECTORS.tab, (els) =>
    els.map((el) => el.getAttribute('data-editor-id') ?? ''),
  );
}

/** The editorIds in current seam order — the logical/state order. */
export async function tabOrderFromSeam(page: Page): Promise<string[]> {
  return (await listTabs(page)).map((t) => t.editorId);
}

/** Count tabs via the seam. */
export async function tabCount(page: Page): Promise<number> {
  return (await listTabs(page)).length;
}

/** Wait until the tab seam reports exactly `n` tabs (settles async UI updates). */
export async function expectTabCount(page: Page, n: number): Promise<void> {
  await expect
    .poll(async () => (await listTabs(page)).length, {
      message: `expected ${n} tabs`,
    })
    .toBe(n);
}

/** Click a tab to activate it (real UI path). */
export async function clickTab(page: Page, editorId: string): Promise<void> {
  await page.locator(tabByEditorId(editorId)).click({ force: true });
}

/** Middle-click a tab (closes it, per UWP + appendix "middle-click close tab"). */
export async function middleClickTab(page: Page, editorId: string): Promise<void> {
  await page.locator(tabByEditorId(editorId)).click({ button: 'middle', force: true });
}

/** Right-click a tab to open its context menu, then return once the menu is visible. */
export async function openTabContextMenu(page: Page, editorId: string): Promise<void> {
  await page.locator(tabByEditorId(editorId)).click({ button: 'right', force: true });
  await expect(page.locator(TAB_SELECTORS.menuClose).first()).toBeVisible();
}

/**
 * Click a context-menu item by its selector. Force-clicks because Fluent v9 Menu
 * items mount with a transition; Playwright's default stability wait can stall on
 * the animating popover and time the test out ("page closed").
 */
export async function clickMenuItem(page: Page, selector: string): Promise<void> {
  await page.locator(selector).click({ force: true });
}

/**
 * Reorder a tab by a REAL pointer drag (the action under test). Drives dnd-kit's
 * PointerSensor (activationConstraint distance:4) via a raw CDP session's
 * Input.dispatchMouseEvent, which dispatches TRUSTED mouse events without
 * Playwright's per-action actionability/stability auto-wait.
 *
 * Why CDP and not page.mouse / in-page dispatch:
 *   - page.mouse.move auto-waits for the page to be "stable" between synthetic
 *     moves; the strip's drag-time re-render churn defeated that and stalled.
 *   - in-page `new PointerEvent(...)` dispatch is untrusted and dnd-kit ignores it
 *     (its PointerSensor binds document listeners expecting trusted events).
 * CDP trusted events drive the genuine dnd wiring and produce a real reorder.
 */
export async function dragTabTo(page: Page, fromEditorId: string, toEditorId: string): Promise<void> {
  const from = page.locator(tabByEditorId(fromEditorId));
  const to = page.locator(tabByEditorId(toEditorId));
  const fb = await from.boundingBox();
  const tb = await to.boundingBox();
  if (!fb || !tb) throw new Error('drag source/target not laid out');

  const fx = fb.x + fb.width / 2;
  const fy = fb.y + fb.height / 2;
  const tx = tb.x + tb.width / 2;
  const ty = tb.y + tb.height / 2;

  const client = await page.context().newCDPSession(page);
  const move = (x: number, y: number): Promise<unknown> =>
    client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });

  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: fx,
    y: fy,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  // Cross the 4px activation threshold, glide to the target, small settle nudge.
  await move(fx + 8, fy);
  await move((fx + tx) / 2, fy);
  await move(tx, ty);
  await move(tx + 2, ty);
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: tx + 2,
    y: ty,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await client.detach();
}

/** Click the add-tab (+) button (real UI path; force-clicks past dnd layout shifts). */
export async function clickAddTab(page: Page): Promise<void> {
  // dnd-kit + ResizeObserver keep nudging strip layout, so Playwright's "stable"
  // actionability check can stall. The add button never moves semantically, so a
  // forced click is correct here.
  await page.locator(TAB_SELECTORS.addTab).click({ force: true });
}

/**
 * Reset the strip to a single fresh untitled tab as a TEST PRECONDITION, via the
 * seam (not Ctrl+W) so resets are fast and never depend on the shortcut under test.
 * Closes all tabs then opens one, leaving a clean known state between cases.
 */
export async function resetToSingleTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    const t = window.__notepadsTest?.tabs;
    if (!t) throw new Error('window.__notepadsTest.tabs not installed (Lane C tab seam missing).');
    for (const tab of t.list()) t.close(tab.editorId);
    if (t.count() === 0) t.newTab();
  });
  await expectTabCount(page, 1);
}

/**
 * Seed the strip to exactly `n` tabs as a TEST PRECONDITION via the seam's
 * real-path `newTab()` mutator (the same store action the add button calls).
 * This is fast and avoids actionability stalls from the live dnd/resize layout.
 * The add-button CLICK path is asserted separately in its own conformance test.
 * Returns the editorIds in order.
 */
export async function seedTabs(page: Page, n: number): Promise<string[]> {
  await page.evaluate((target) => {
    const t = window.__notepadsTest?.tabs;
    if (!t) throw new Error('window.__notepadsTest.tabs not installed (Lane C tab seam missing).');
    while (t.count() < target) t.newTab();
  }, n);
  await expectTabCount(page, n);
  return tabOrderFromSeam(page);
}
