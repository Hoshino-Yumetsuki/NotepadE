import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { setEditorDoc, focusEditor, setSelection, getDocText } from './helpers/editor';

/**
 * Scroll-anchoring conformance (task #3): pressing Enter with the caret line
 * VISIBLE (not at the viewport's bottom edge) must never shift the content
 * ABOVE the caret — the caret line holds its screen position and the content
 * below pushes down (classic Notepad behavior).
 *
 * Regression context: CM6 anchors scroll to the document END when the scroller
 * is within 4px of the bottom (`scrolledToBottom`). With only 10px of content
 * bottom padding, editing at EOF was almost always in that state, so inserting
 * a line pinned the BOTTOM and shifted everything above the caret UP by one
 * row — even when the caret line sat mid-screen. scrollPastEnd()
 * (CodeMirrorEditor.tsx) adds a viewport of virtual space below the last line,
 * so the bottom-anchored branch effectively never activates AND the last line
 * can be scrolled up to mid-screen at all (impossible before the fix — both
 * tests below depend on that to even arrange their precondition).
 *
 * (A caret at the very bottom EDGE still scrolls one line on Enter — that is
 * the legitimate cursor scroll-into-view every editor does, not this bug.)
 */

type Pg = import('@playwright/test').Page;

/** Screen Y of the .cm-line whose text starts with `marker` (null if not rendered). */
async function lineTop(page: Pg, marker: string): Promise<number | null> {
  return page.evaluate((m) => {
    const host = document.querySelector(
      '[data-testid="editor-host"]:not([style*="display: none"])'
    );
    if (!host) return null;
    const lines = Array.from(host.querySelectorAll('.cm-line')) as HTMLElement[];
    const ln = lines.find((l) => (l.textContent ?? '').startsWith(m));
    return ln ? ln.getBoundingClientRect().top : null;
  }, marker);
}

/**
 * Scroll the editor so the line starting with `marker` sits at the vertical
 * CENTER of the scroller. For the last line this is only possible at all with
 * scroll-past-end space, so the arrangement itself exercises the fix.
 *
 * The scroll is RE-APPLIED on every poll iteration: a just-pressed key (e.g.
 * Ctrl+End) leaves a pending cursor scroll-target that CM6 applies in a later
 * measure phase, which would override a single programmatic scrollTop write.
 * Retrying until the position sticks across a frame absorbs that race.
 */
async function centerLine(page: Pg, marker: string): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate(async (m) => {
        const host = document.querySelector(
          '[data-testid="editor-host"]:not([style*="display: none"])'
        );
        if (!host) return false;
        const scroller = host.querySelector('.cm-scroller') as HTMLElement;
        const find = () =>
          (Array.from(host.querySelectorAll('.cm-line')) as HTMLElement[]).find((l) =>
            (l.textContent ?? '').startsWith(m)
          );
        const ln = find();
        if (!ln) return false;
        const sr = scroller.getBoundingClientRect();
        // Doc-relative top of the line, then place it at the scroller's center.
        const docTop = ln.getBoundingClientRect().top - sr.top + scroller.scrollTop;
        scroller.scrollTop = docTop - scroller.clientHeight / 2;
        // Two frames: let CM6 absorb the scroll (and apply any pending cursor
        // scroll-target that would override us — the next iteration retries).
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ln2 = find();
        if (!ln2) return false;
        const mid = sr.top + sr.height / 2;
        return Math.abs(ln2.getBoundingClientRect().top - mid) < 40;
      }, marker);
    })
    .toBe(true);
}

/** Assert `marker`'s screen Y stays within 1px of `baseline` (settles via poll). */
async function expectLineHeld(page: Pg, marker: string, baseline: number): Promise<void> {
  await expect
    .poll(async () => {
      const t = await lineTop(page, marker);
      return t === null ? Infinity : Math.abs(t - baseline);
    })
    .toBeLessThanOrEqual(1);
}

test('Enter at EOF (caret line mid-screen) keeps the lines above at the same screen Y', async () => {
  const { app, page } = await launchApp();
  try {
    // 200 numbered lines — far more than fit a viewport, so the editor scrolls.
    const lines = Array.from({ length: 200 }, (_, i) => `row-${i + 1}#`);
    const doc = lines.join('\n');
    await setEditorDoc(page, doc, doc.length);
    await focusEditor(page);
    await page.keyboard.press('Control+End');
    await expect.poll(() => lineTop(page, 'row-200#')).not.toBeNull();

    // Scroll the LAST line up to mid-viewport (needs scroll-past-end space).
    await centerLine(page, 'row-200#');
    const beforeCaretLine = (await lineTop(page, 'row-200#')) as number;
    const beforeAbove = (await lineTop(page, 'row-195#')) as number;

    await page.keyboard.press('Enter');
    // The newline lands in the doc...
    await expect.poll(() => getDocText(page)).toBe(doc + '\n');

    // ...and NOTHING above the new line moved (the bug pinned the BOTTOM and
    // shifted all of this up by one row).
    await expectLineHeld(page, 'row-200#', beforeCaretLine);
    await expectLineHeld(page, 'row-195#', beforeAbove);
  } finally {
    await app.close();
  }
});

test('Enter mid-file keeps the lines above the caret still and pushes lines below down', async () => {
  const { app, page } = await launchApp();
  try {
    const lines = Array.from({ length: 200 }, (_, i) => `row-${i + 1}#`);
    const doc = lines.join('\n');
    // Caret at the END of row-100 (mid-file).
    const caret = doc.indexOf('row-101#') - 1;
    await setEditorDoc(page, doc, caret);
    await focusEditor(page);
    await setSelection(page, caret, caret);
    // Nudge through the real surface so CM6 scrolls the caret into view...
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => lineTop(page, 'row-100#')).not.toBeNull();
    // ...then center the caret line so Enter needs NO legitimate cursor scroll.
    await centerLine(page, 'row-100#');

    const beforeAbove = (await lineTop(page, 'row-97#')) as number;
    const beforeCaretLine = (await lineTop(page, 'row-100#')) as number;
    const beforeBelow = (await lineTop(page, 'row-103#')) as number;

    await page.keyboard.press('Enter');
    await expect.poll(async () => (await getDocText(page)).length).toBe(doc.length + 1);

    // Above + caret line: unmoved. Below: pushed DOWN by one row.
    await expectLineHeld(page, 'row-97#', beforeAbove);
    await expectLineHeld(page, 'row-100#', beforeCaretLine);
    await expect
      .poll(async () => ((await lineTop(page, 'row-103#')) as number) - beforeBelow)
      .toBeGreaterThan(5);
  } finally {
    await app.close();
  }
});
