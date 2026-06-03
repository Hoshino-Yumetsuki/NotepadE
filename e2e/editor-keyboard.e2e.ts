import { test, expect } from '@playwright/test';
import { launchApp, type LaunchedApp } from './helpers/launch';
import { resetToSingleTab } from './helpers/tabs';
import {
  EDITOR_SELECTORS,
  focusEditor,
  setEditorDoc,
  setSelection,
  getDocText,
  getSelection,
  getZoomPercent,
  isWordWrap,
  getDirection,
  undoDepth,
  redoDepth,
  installWebSearchSpy,
  lastWebSearchQuery,
  expectFindBarVisible,
  expectFindBarHidden,
} from './helpers/editor';

/**
 * VERIFICATION GATE 3 — Keyboard conformance (docs/plan/04 §GATE 3, appendix §10).
 *
 *   "Keyboard conformance: 100% of appendix bindings (zero tolerance)."
 *
 * Drives REAL key events against the live Electron CM6 surface and asserts each
 * binding ACTS (state changed) via the renderer-only editor seam — never the seam
 * mutators, so a green run proves the wiring, not the test's own setup.
 *
 * Bindings under test (appendix §"Editor core — editing" + §"find/replace/nav"):
 *   Ctrl+D duplicate · Ctrl+J join · Alt+↑/↓ move line · Alt+←/→ move word ·
 *   Tab/Shift+Tab indent/outdent · Enter auto-indent · F5 datetime ·
 *   Ctrl+E web search (shell.webSearch spy) · Ctrl+L/Ctrl+R direction ·
 *   Alt+Z word wrap · Ctrl+=/Ctrl+-/Ctrl+0 zoom · Ctrl+F/Ctrl+H/Ctrl+G open bars ·
 *   F3/Shift+F3 repeat find · Ctrl+Z/Ctrl+Shift+Z undo/redo.
 *
 * Requires the Phase-3 editor seam (window.__notepadsTest.editor) + useFindBar
 * mounted in App (Task 1A). Each test resets to a single fresh tab first.
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

// --- Editing commands -------------------------------------------------------

test('Ctrl+D duplicates the current line', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'alpha');
  await page.keyboard.press('Control+d');
  expect(await getDocText(page)).toBe('alpha\nalpha');
});

test('Ctrl+J joins lines with a single space', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'one\ntwo');
  // Selection must SPAN both lines (joining a single line is a UWP no-op).
  await setSelection(page, 0, (await getDocText(page)).length);
  await page.keyboard.press('Control+j');
  expect(await getDocText(page)).toBe('one two');
});

test('Alt+ArrowDown moves the current line down', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'first\nsecond');
  await setSelection(page, 0, 0); // caret on "first"
  await page.keyboard.press('Alt+ArrowDown');
  expect(await getDocText(page)).toBe('second\nfirst');
});

test('Alt+ArrowUp moves the current line up', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'first\nsecond');
  const docLen = (await getDocText(page)).length;
  await setSelection(page, docLen, docLen); // caret on "second"
  await page.keyboard.press('Alt+ArrowUp');
  expect(await getDocText(page)).toBe('second\nfirst');
});

test('Alt+ArrowRight / Alt+ArrowLeft move words (the binding acts)', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'aaa bbb ccc');
  await setSelection(page, 4, 4); // caret in the middle word "bbb"
  const before = await getDocText(page);
  await page.keyboard.press('Alt+ArrowRight');
  const afterRight = await getDocText(page);
  expect(afterRight).not.toBe(before); // word reorder occurred
  await page.keyboard.press('Alt+ArrowLeft');
  // The two operations are inverse for a middle word; doc returns to original.
  expect(await getDocText(page)).toBe(before);
});

test('Tab indents and Shift+Tab outdents', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'x');
  await setSelection(page, 0, 0);
  await page.keyboard.press('Tab');
  const indented = await getDocText(page);
  expect(indented.length).toBeGreaterThan(1); // a tab/space was inserted at line start
  expect(indented.endsWith('x')).toBe(true);
  await setSelection(page, 0, 0);
  await page.keyboard.press('Shift+Tab');
  expect(await getDocText(page)).toBe('x'); // outdent removed the indent
});

test('Enter inserts a newline with auto-indent (copies leading whitespace)', async () => {
  const { page } = launched;
  // Build a line that already has leading indentation, caret at end of it.
  await setEditorDoc(page, '');
  await page.keyboard.type('    code'); // 4 spaces + code (typed verbatim)
  await page.keyboard.press('Enter');
  await page.keyboard.type('next');
  const doc = await getDocText(page);
  // The second line inherits the 4-space indent before "next".
  expect(doc).toBe('    code\n    next');
});

test('F5 inserts a datetime string at the caret', async () => {
  const { page } = launched;
  await setEditorDoc(page, '');
  await page.keyboard.press('F5');
  const doc = await getDocText(page);
  expect(doc.length).toBeGreaterThan(0);
  // Locale-default datetime contains at least one digit and a separator.
  expect(/\d/.test(doc)).toBe(true);
});

// --- Web search (Ctrl+E) ----------------------------------------------------

test('Ctrl+E web-searches the trimmed selection via shell.webSearch', async () => {
  const { page } = launched;
  await installWebSearchSpy(page);
  await setEditorDoc(page, '  needle  '); // surrounding whitespace
  await setSelection(page, 0, (await getDocText(page)).length); // select all
  await page.keyboard.press('Control+e');
  await expect.poll(() => lastWebSearchQuery(page)).toBe('needle');
});

// --- Direction --------------------------------------------------------------

test('Ctrl+R sets RTL and Ctrl+L sets LTR', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'text');
  expect(await getDirection(page)).toBe('ltr');
  await page.keyboard.press('Control+r');
  expect(await getDirection(page)).toBe('rtl');
  await page.keyboard.press('Control+l');
  expect(await getDirection(page)).toBe('ltr');
});

// --- Word wrap --------------------------------------------------------------

test('Alt+Z toggles word wrap', async () => {
  const { page } = launched;
  const before = await isWordWrap(page);
  await page.keyboard.press('Alt+z');
  expect(await isWordWrap(page)).toBe(!before);
  await page.keyboard.press('Alt+z');
  expect(await isWordWrap(page)).toBe(before);
});

// --- Zoom -------------------------------------------------------------------

test('Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets to 100%', async () => {
  const { page } = launched;
  expect(await getZoomPercent(page)).toBe(100);
  await page.keyboard.press('Control+=');
  expect(await getZoomPercent(page)).toBe(110);
  await page.keyboard.press('Control+-');
  expect(await getZoomPercent(page)).toBe(100);
  await page.keyboard.press('Control+=');
  expect(await getZoomPercent(page)).toBe(110);
  await page.keyboard.press('Control+0');
  expect(await getZoomPercent(page)).toBe(100);
});

// --- Find / replace / nav bars ---------------------------------------------

test('Ctrl+F opens the find bar; Escape dismisses it', async () => {
  const { page } = launched;
  await page.keyboard.press('Control+f');
  await expectFindBarVisible(page);
  await page.keyboard.press('Escape');
  await expectFindBarHidden(page);
});

test('Ctrl+H opens the find bar with the replace row', async () => {
  const { page } = launched;
  await page.keyboard.press('Control+h');
  await expectFindBarVisible(page);
  await expect(page.locator(EDITOR_SELECTORS.replaceInput)).toBeVisible();
  await page.keyboard.press('Escape');
  await expectFindBarHidden(page);
});

test('Ctrl+G opens the go-to-line prompt', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'l1\nl2\nl3');
  // useFindBar's openGoToLine uses window.prompt; accept it and go to line 2.
  page.once('dialog', (d) => void d.accept('2'));
  await page.keyboard.press('Control+g');
  // Caret landed on line 2 start (offset 3 = after "l1\n").
  await expect.poll(async () => (await getSelection(page)).from).toBe(3);
});

test('F3 / Shift+F3 repeat the active find (open the bar when none active)', async () => {
  const { page } = launched;
  // With no active query, F3 opens the find bar (UWP shows the bar).
  await page.keyboard.press('F3');
  await expectFindBarVisible(page);
  await page.keyboard.press('Escape');
  await expectFindBarHidden(page);

  // Now run a real search, then F3 repeats it (advances the selection).
  await setEditorDoc(page, 'foo bar foo bar foo');
  await setSelection(page, 0, 0);
  await page.keyboard.press('Control+f');
  await expectFindBarVisible(page);
  await page.locator(EDITOR_SELECTORS.findInput).fill('foo');
  await page.keyboard.press('Enter'); // first find
  const first = await getSelection(page);
  expect(first.to - first.from).toBe(3); // "foo" selected
  await focusEditor(page); // move focus to the editor so F3 hits the editor keymap
  await page.keyboard.press('F3'); // next "foo"
  const second = await getSelection(page);
  expect(second.from).toBeGreaterThan(first.from);
  await page.keyboard.press('Shift+F3'); // previous "foo" — back to the first
  const back = await getSelection(page);
  expect(back.from).toBe(first.from);
});

// --- Undo / redo ------------------------------------------------------------

test('Ctrl+Z undoes and Ctrl+Shift+Z redoes', async () => {
  const { page } = launched;
  await setEditorDoc(page, 'base');
  await setSelection(page, 4, 4);
  await page.keyboard.type('X'); // one edit
  expect(await getDocText(page)).toBe('baseX');
  const depthBefore = await undoDepth(page);
  expect(depthBefore).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');
  expect(await getDocText(page)).toBe('base');
  expect(await redoDepth(page)).toBeGreaterThan(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await getDocText(page)).toBe('baseX');
});
