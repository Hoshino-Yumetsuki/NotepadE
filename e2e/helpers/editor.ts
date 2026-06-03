import { expect, type Page } from '@playwright/test';

/**
 * Editor-surface e2e driver (Phase-3 gap harness).
 *
 * Thin, typed wrappers over `window.__notepadsTest.editor` (the renderer-only,
 * NOTEPADS_E2E-gated CM6 seam) so the keyboard-conformance and undo-granularity
 * suites read as behavioral assertions rather than evaluate-soup. Key events are
 * always driven through the REAL surface (`.cm-content` focused + page.keyboard),
 * never the seam mutators — the seam is only for arranging preconditions and
 * reading exact state.
 *
 * PA-8: this helper runs in the Playwright/node process and only ever calls into
 * the public seam from inside page.evaluate; it adds no IPC surface.
 */

export const EDITOR_SELECTORS = {
  /** The active tab's CM6 content surface (the one that is display:block). */
  content: '[data-testid="editor-host"]:not([style*="display: none"]) .cm-content',
  /** Any CM6 content surface (single-editor cases). */
  anyContent: '.cm-content',
  /** The find bar (mounted by useFindBar; visible only when open). */
  findBar: '[data-testid="find-bar"]',
  findInput: '[data-testid="find-input"]',
  replaceInput: '[data-testid="replace-input"]',
} as const;

/** Assert the editor seam is installed (fails loudly if lane-b hasn't shipped it). */
async function requireEditorSeam(page: Page): Promise<void> {
  const present = await page.evaluate(() => !!window.__notepadsTest?.editor);
  if (!present) {
    throw new Error(
      'window.__notepadsTest.editor not installed (Phase-3 editor seam missing). ' +
        'App must install the editor seam under NOTEPADS_E2E (src/renderer/editor/test-hook.ts).',
    );
  }
}

/** Focus the active CM6 surface so subsequent key events route to the editor. */
export async function focusEditor(page: Page): Promise<void> {
  await requireEditorSeam(page);
  await page.evaluate(() => window.__notepadsTest?.editor?.focus());
  // A real DOM focus too, so page.keyboard targets the contenteditable.
  await page.locator(EDITOR_SELECTORS.anyContent).first().click();
}

/**
 * Arrange a deterministic document + caret in the active editor as a TEST
 * PRECONDITION. Goes through the REAL surface: focus, select-all, delete, then
 * type the text (so the editor's own input path builds the doc), then place the
 * caret. Typing keeps this free of any extra seam method — it uses only focus +
 * setSelection from the editor seam and genuine key events.
 *
 * Note: this types literal characters; newlines in `text` are entered as Enter
 * presses. Because Enter is auto-indent-bound, callers that need verbatim
 * multi-line text with leading whitespace should arrange line content that does
 * not depend on auto-indent, or assert relative to what auto-indent produces.
 */
export async function setEditorDoc(page: Page, text: string, caret?: number): Promise<void> {
  await focusEditor(page);
  // Select-all + delete to clear, via real keys.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  if (text.length > 0) {
    // Insert atomically through the seam-free clipboard-less path: type lines,
    // pressing Enter between them. We avoid auto-indent surprises by typing each
    // line's content as-is (callers control content).
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Enter');
      if (lines[i].length > 0) await page.keyboard.type(lines[i]);
    }
  }
  const at = caret ?? (await getDocText(page)).length;
  await setSelection(page, at, at);
}

/**
 * Insert `text` verbatim at the current selection in ONE programmatic dispatch
 * (a single transaction = one undo step), used to model a PASTE. Goes through the
 * editor seam's insert path so it counts as exactly one history event, matching
 * how a real clipboard paste is grouped.
 */
export async function pasteText(page: Page, text: string): Promise<void> {
  await requireEditorSeam(page);
  await page.evaluate((t) => {
    const hook = window.__notepadsTest?.editor;
    if (!hook?.insertAsPaste) {
      throw new Error('editor seam lacks insertAsPaste; cannot model a single-step paste');
    }
    hook.insertAsPaste(t);
  }, text);
}

export async function getDocText(page: Page): Promise<string> {
  return page.evaluate(() => window.__notepadsTest?.editor?.getDocText() ?? '');
}

export async function getSelection(page: Page): Promise<{ from: number; to: number }> {
  return page.evaluate(
    () => window.__notepadsTest?.editor?.getSelection() ?? { from: 0, to: 0 },
  );
}

export async function setSelection(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(
    ([f, t]) => window.__notepadsTest?.editor?.setSelection(f, t),
    [from, to] as const,
  );
}

export async function getZoomPercent(page: Page): Promise<number> {
  return page.evaluate(() => window.__notepadsTest?.editor?.getZoomPercent() ?? 100);
}

export async function isWordWrap(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__notepadsTest?.editor?.isWordWrap() ?? false);
}

export async function getDirection(page: Page): Promise<'ltr' | 'rtl'> {
  return page.evaluate(() => window.__notepadsTest?.editor?.getDirection() ?? 'ltr');
}

export async function undoDepth(page: Page): Promise<number> {
  return page.evaluate(() => window.__notepadsTest?.editor?.undoDepth() ?? 0);
}

export async function redoDepth(page: Page): Promise<number> {
  return page.evaluate(() => window.__notepadsTest?.editor?.redoDepth() ?? 0);
}

export async function isLogEntryGuardSet(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__notepadsTest?.editor?.isLogEntryGuardSet() ?? false);
}

// ---------------------------------------------------------------------------
//  Web-search spy (Ctrl+E). Owned entirely by the e2e: we override the public
//  bridge method on the test page BEFORE the keypress and read the captured
//  query back. main's shell.webSearch is a Phase-1 stub, so this never reaches
//  the OS — we only assert the renderer command produced the right query.
// ---------------------------------------------------------------------------

/** Install a spy over window.notepads.shell.webSearch; resets the recorded query. */
export async function installWebSearchSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __webSearchSpy?: string | null };
    w.__webSearchSpy = null;
    const original = window.notepads.shell.webSearch.bind(window.notepads.shell);
    window.notepads.shell.webSearch = async (query: string) => {
      w.__webSearchSpy = query;
      // Don't actually invoke main (it's a notImplemented stub); resolve ok so
      // the fire-and-forget caller never logs an error.
      void original;
      return { ok: true as const, data: undefined as unknown as void };
    };
  });
}

/** Read the last query captured by the web-search spy (null if none). */
export async function lastWebSearchQuery(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __webSearchSpy?: string | null };
    return w.__webSearchSpy ?? null;
  });
}

/** Wait until the find bar is visible (Ctrl+F / Ctrl+H opened it). */
export async function expectFindBarVisible(page: Page): Promise<void> {
  await expect(page.locator(EDITOR_SELECTORS.findBar)).toBeVisible();
}

/** Wait until the find bar is gone (Escape dismissed it). */
export async function expectFindBarHidden(page: Page): Promise<void> {
  await expect(page.locator(EDITOR_SELECTORS.findBar)).toHaveCount(0);
}
