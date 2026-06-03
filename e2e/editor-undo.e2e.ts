import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { resetToSingleTab } from './helpers/tabs';
import {
  EDITOR_SELECTORS,
  focusEditor,
  setEditorDoc,
  setSelection,
  getDocText,
  undoDepth,
  pasteText,
  expectFindBarVisible,
} from './helpers/editor';

/**
 * VERIFICATION GATE 3 — Undo granularity (docs/plan/04 §3.B2 + risk R1).
 *
 * UWP groups undo steps so that:
 *   - a PASTE is ONE undo step,
 *   - replace-ALL is ONE undo step (single SetText),
 *   - iterative replace-ONE produces N undo steps (N distinct edits),
 *   - SMART COPY creates ZERO undo steps (copy never mutates the document).
 *
 * We assert the delta in CM6 history undoDepth around each operation. Driven
 * through the real editor + find controller; the editor seam exposes undoDepth
 * and a single-transaction paste model (insertAsPaste).
 */

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.app.close();
});

test.beforeEach(async () => {
  await resetToSingleTab(launched.page);
  await focusEditor(launched.page);
});

test('paste = exactly 1 undo step', async () => {
  const { page } = launched;
  await setEditorDoc(page, '');
  const before = await undoDepth(page);
  await pasteText(page, 'multi\nline\npaste');
  expect(await getDocText(page)).toBe('multi\nline\npaste');
  const after = await undoDepth(page);
  expect(after - before).toBe(1);
  // And one undo restores the pre-paste document.
  await page.keyboard.press('Control+z');
  expect(await getDocText(page)).toBe('');
});

test('replace-all = exactly 1 undo step', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'x x x x x');
  await setSelection(page, 0, 0);
  const before = await undoDepth(page);

  await page.keyboard.press('Control+h');
  await expectFindBarVisible(page);
  await page.locator(EDITOR_SELECTORS.findInput).fill('x');
  await page.locator(EDITOR_SELECTORS.replaceInput).fill('y');
  await page.locator('[data-testid="replace-all"]').click();

  expect(await getDocText(page)).toBe('y y y y y');
  const after = await undoDepth(page);
  expect(after - before).toBe(1);
  // One undo restores the entire original (proves it was a single SetText).
  await focusEditor(page);
  await page.keyboard.press('Control+z');
  expect(await getDocText(page)).toBe('x x x x x');
});

test('iterative replace-one = N undo steps (one per replacement)', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'x x x');
  await setSelection(page, 0, 0);
  const before = await undoDepth(page);

  await page.keyboard.press('Control+h');
  await expectFindBarVisible(page);
  await page.locator(EDITOR_SELECTORS.findInput).fill('x');
  await page.locator(EDITOR_SELECTORS.replaceInput).fill('y');

  // Replace each of the 3 occurrences individually.
  const replaceOne = page.locator('[data-testid="replace-one"]');
  await replaceOne.click();
  await replaceOne.click();
  await replaceOne.click();

  expect(await getDocText(page)).toBe('y y y');
  const after = await undoDepth(page);
  // 3 distinct edits → at least 3 history steps (one per replacement).
  expect(after - before).toBe(3);
});

test('smart copy = 0 undo steps (copy never mutates the document)', async () => {
  const { page } = launched;
  // Smart Copy default-off; even forcing a copy must not create an undo step.
  await setEditorDoc(page, '  trimme  ');
  await setSelection(page, 0, (await getDocText(page)).length);
  const docBefore = await getDocText(page);
  const before = await undoDepth(page);

  await page.keyboard.press('Control+c');

  // Copy is non-mutating: document + undo depth unchanged.
  expect(await getDocText(page)).toBe(docBefore);
  expect(await undoDepth(page)).toBe(before);
});
