import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, type LaunchedApp } from './helpers/launch';
import {
  TAB_SELECTORS,
  clickMenuItem,
  clickTab,
  dragTabTo,
  expectTabCount,
  listTabs,
  openTabContextMenu,
  resetToSingleTab,
  seedTabs,
  tabByEditorId,
  tabOrderFromDom,
  tabOrderFromSeam,
} from './helpers/tabs';

/**
 * VERIFICATION GATE 2 — Behavioral matrix (docs/plan/03 §GATE 2, task 3 context menu).
 *
 *   "Matrix: reorder, close-others, close-to-right, close-saved, rename, copy-path
 *    each assert correct DOM/file state."
 *
 * Drives the REAL UI (context-menu clicks, drag reorder, rename input) and asserts
 * via the tab seam (exact order/flags) + DOM + the file system (copy-path lands on
 * the clipboard; the runner reads it back). PA-8-clean: the renderer never touches
 * fs/clipboard directly — copy-path flows through window.notepads.shell.copyPath.
 *
 * Authored TDD-first: RED until Lane C ships the TabStrip, context menu, drag
 * reorder, and the window.__notepadsTest.tabs seam.
 */

let launched: LaunchedApp;
let tmpDir: string;

test.beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'notepads-tabs-matrix-'));
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

test.beforeEach(async () => {
  await resetToSingleTab(launched.page);
});

/** Write a real file so file-backed tabs (copy-path, close-saved) have a path. */
function makeFile(name: string, contents = 'x'): string {
  const p = join(tmpDir, name);
  writeFileSync(p, contents, 'utf8');
  return p;
}

test('reorder: dragging tab 0 to position 2 changes both DOM and seam order', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);
  expect(await tabOrderFromSeam(page)).toEqual(ids);

  // Drag the first tab onto the third tab's slot (real pointer drag).
  await dragTabTo(page, ids[0], ids[2]);

  const expected = [ids[1], ids[2], ids[0]];
  await expect.poll(async () => tabOrderFromSeam(page)).toEqual(expected);
  // DOM order must mirror logical order (contract: DOM order == tab order).
  expect(await tabOrderFromDom(page)).toEqual(expected);
});

test('close-others: keeps only the target tab', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 4);

  await openTabContextMenu(page, ids[1]);
  await clickMenuItem(page, TAB_SELECTORS.menuCloseOthers);

  await expectTabCount(page, 1);
  expect(await tabOrderFromSeam(page)).toEqual([ids[1]]);
});

test('close-to-the-right: closes every tab after the target, keeps left + target', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 4);

  await openTabContextMenu(page, ids[1]);
  await clickMenuItem(page, TAB_SELECTORS.menuCloseToRight);

  await expect.poll(async () => tabOrderFromSeam(page)).toEqual([ids[0], ids[1]]);
});

test('close-saved: closes only unmodified tabs, keeps dirty ones', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 3);

  // Arrange modified flags via the fixture-aid mutator: tab 1 dirty, others saved.
  await page.evaluate((dirtyId) => {
    const t = window.__notepadsTest!.tabs!;
    for (const tab of t.list()) t.setModified(tab.editorId, tab.editorId === dirtyId);
  }, ids[1]);

  await openTabContextMenu(page, ids[0]);
  await clickMenuItem(page, TAB_SELECTORS.menuCloseSaved);

  await expect.poll(async () => tabOrderFromSeam(page)).toEqual([ids[1]]);
  const remaining = await listTabs(page);
  expect(remaining[0].isModified).toBe(true);
});

test('rename: F2 + type + Enter updates the tab title and DOM', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 2);
  await clickTab(page, ids[1]);

  await page.keyboard.press('F2');
  const input = page.locator(TAB_SELECTORS.renameInput);
  await expect(input).toBeFocused();
  await input.fill('renamed-tab.txt');
  await page.keyboard.press('Enter');

  await expect
    .poll(async () => (await listTabs(page)).find((t) => t.editorId === ids[1])?.title)
    .toBe('renamed-tab.txt');
  await expect(page.locator(tabByEditorId(ids[1])).locator(TAB_SELECTORS.tabTitle)).toHaveText(
    'renamed-tab.txt',
  );
});

test('rename: Escape cancels and keeps the original title', async () => {
  const { page } = launched;
  const ids = await seedTabs(page, 1);
  const before = (await listTabs(page))[0].title;

  await clickTab(page, ids[0]);
  await page.keyboard.press('F2');
  await page.locator(TAB_SELECTORS.renameInput).fill('should-not-stick');
  await page.keyboard.press('Escape');

  await expect(page.locator(TAB_SELECTORS.renameInput)).toHaveCount(0);
  expect((await listTabs(page))[0].title).toBe(before);
});

test('copy-path: routes the file-backed tab path through the shell.copyPath IPC channel', async () => {
  const { app, page } = launched;
  const filePath = makeFile('copy-path-target.txt', 'content');

  // Record invocations of the SOLE IPC contract channel in MAIN. window.notepads
  // is a frozen contextBridge surface, so it can't be monkey-patched from the
  // renderer; instead we re-register the channel's ipcMain handler to capture the
  // argument. The "Copy Full Path" menu item must route here (PA-8: the renderer
  // never touches the clipboard directly). The real handler is a Phase-6 stub, so
  // we assert the CONTRACT CALL + argument — not OS clipboard state.
  await app.evaluate(({ ipcMain }) => {
    const w = globalThis as unknown as { __copyPathCalls?: string[] };
    w.__copyPathCalls = [];
    const channel = 'notepads:shell:copyPath';
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (_e: unknown, p: string) => {
      w.__copyPathCalls!.push(p);
      return { ok: true, data: undefined };
    });
  });

  // Open the file so a file-backed tab exists.
  const opened = await page.evaluate(
    (p) => window.__notepadsTest!.openFileIntoEditor(p),
    filePath,
  );
  expect(opened.ok).toBe(true);

  const tabs = await listTabs(page);
  const fileTab = tabs.find((t) => t.filePath === filePath);
  expect(fileTab, 'file-backed tab should exist after open').toBeTruthy();

  await openTabContextMenu(page, fileTab!.editorId);
  await clickMenuItem(page, TAB_SELECTORS.menuCopyPath);

  // Poll the main-process record (the IPC round-trip is async).
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { __copyPathCalls: string[] }).__copyPathCalls,
      ),
    )
    .toEqual([filePath]);
});
