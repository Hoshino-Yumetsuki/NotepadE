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
  // The seam calls view.focus() on the ACTIVE tab's CM6 view — real DOM focus on
  // the contenteditable, which is what routes page.keyboard events to the editor.
  // We deliberately do NOT click the surface: App mounts every tab's editor
  // (inactive ones display:none) and CM6's contenteditable micro-reflows
  // continuously, so a Playwright click would stall on the stability wait. The
  // seam focus is sufficient and reliable.
  await page.evaluate(() => window.__notepadsTest?.editor?.focus());
  // Confirm the surface actually holds focus before driving keys.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ae = document.activeElement;
        return !!ae && ae.classList.contains('cm-content');
      }),
    )
    .toBe(true);
}

/**
 * Arrange a deterministic document + caret in the active editor as a TEST
 * PRECONDITION. Driven entirely through the seam (select-all via setSelection +
 * a single insert) so it is fast and never depends on keyboard focus timing or
 * CM6 actionability. The insert path is tagged as a paste; callers that assert
 * undo DELTAS capture their baseline AFTER this setup, so the setup's history is
 * absorbed into the baseline and does not skew the measured delta.
 */
export async function setEditorDoc(page: Page, text: string, caret?: number): Promise<void> {
  await requireEditorSeam(page);
  await page.evaluate(
    ({ text: t, caret: c }) => {
      const hook = window.__notepadsTest?.editor;
      if (!hook) throw new Error('editor seam missing');
      const len = hook.getDocText().length;
      hook.setSelection(0, len); // select all
      hook.insertAsPaste(t); // replace selection with the new doc
      const at = c ?? hook.getDocText().length;
      hook.setSelection(at, at);
    },
    { text, caret },
  );
  await focusEditor(page);
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
//  Web-search spy (Ctrl+E). window.notepads.shell is a FROZEN contract object
//  (Object.isFrozen === true), so it cannot be patched from the test page. The
//  capture is therefore done by the renderer's editor seam under NOTEPADS_E2E
//  (editor.lastWebSearchQuery), which records the query webSearchSelection
//  hands to the bridge. main's shell.webSearch is a stub, so nothing reaches the
//  OS — we only assert the renderer command produced the right query.
// ---------------------------------------------------------------------------

/** Reset the seam's recorded web-search query before exercising Ctrl+E. */
export async function resetWebSearchSpy(page: Page): Promise<void> {
  await requireEditorSeam(page);
  await page.evaluate(() => window.__notepadsTest?.editor?.resetWebSearch?.());
}

/** Read the last query the editor seam recorded for shell.webSearch (null if none). */
export async function lastWebSearchQuery(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__notepadsTest?.editor?.lastWebSearchQuery?.() ?? null);
}

/** Wait until the find bar is visible (Ctrl+F / Ctrl+H opened it). */
export async function expectFindBarVisible(page: Page): Promise<void> {
  await expect(page.locator(EDITOR_SELECTORS.findBar)).toBeVisible();
}

/** Wait until the find bar is gone (Escape dismissed it). */
export async function expectFindBarHidden(page: Page): Promise<void> {
  await expect(page.locator(EDITOR_SELECTORS.findBar)).toHaveCount(0);
}
