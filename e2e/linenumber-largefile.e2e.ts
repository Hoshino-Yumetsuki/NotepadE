import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { focusEditor } from './helpers/editor';

/**
 * Large-file line-number integrity (task #4): in documents tall enough to
 * trigger CM6's BigScaler (> 7,000,000px ≈ ~420k lines at default metrics),
 * inserting lines must NOT detach the external line-number column from the
 * text.
 *
 * Regression context: every edit in BigScaler territory rescales EVERY
 * block.top; CM6 writes its compensating scrollTop only later, in the measure
 * phase. lineNumberColumn used to lay cells out synchronously in update(),
 * pairing NEW scaled tops with the STALE scrollTop — numbers detached from
 * their lines ("插入行不正常全坏了"). The fix routes edit-driven relayout
 * through view.requestMeasure and positions each cell from its RENDERED
 * `.cm-line` rect (scaler-proof by construction).
 */

type Pg = import('@playwright/test').Page;

/** 500k lines ≈ 8.4M px tall at default metrics — comfortably BigScaler. */
const LINE_COUNT = 500_000;

/** Wait until the NOTEPADS_E2E editor seam is installed (post editor mount). */
async function waitForSeam(page: Pg): Promise<void> {
  await expect.poll(() => page.evaluate(() => !!window.__notepadsTest?.editor)).toBe(true);
}

/**
 * Seed a doc of `n` marker lines (`x<i>;`) built INSIDE the page (shipping a
 * multi-MB string through evaluate's serializer is slow). Mirrors the helpers'
 * setEditorDoc fallback: select-all + one insertAsPaste, caret at `caret`.
 */
async function seedMarkerDoc(page: Pg, n: number, caret: number | 'end'): Promise<void> {
  await page.evaluate(
    ({ n: count, caret: c }) => {
      const hook = window.__notepadsTest?.editor;
      if (!hook) throw new Error('editor seam missing');
      const lines = new Array<string>(count);
      for (let i = 0; i < count; i++) lines[i] = `x${i + 1};`;
      const doc = lines.join('\n');
      hook.setSelection(0, hook.getDocText().length);
      hook.insertAsPaste(doc);
      const at = c === 'end' ? doc.length : (c as number);
      hook.setSelection(at, at);
    },
    { n, caret }
  );
}

/**
 * Max |cell.top − .cm-line.top| across all visible number cells (plus the
 * worst pair, for diagnostics). Each cell numbered `n` is paired with the
 * .cm-line whose text is the marker that line carries after accounting for
 * `inserted` empty lines added at the END of line `insertLine`:
 *   n <= insertLine                 → `x<n>;`
 *   insertLine < n <= insertLine+I  → inserted line (no marker — skipped)
 *   n > insertLine + I              → `x<n − I>;`
 * Returns null until at least one cell/line pair is measurable.
 */
async function cellLineReport(
  page: Pg,
  insertLine = Number.MAX_SAFE_INTEGER,
  inserted = 0
): Promise<{ max: number; worst: string } | null> {
  return page.evaluate(
    ({ insertLine: il, inserted: ins }) => {
      const host = document.querySelector(
        '[data-testid="editor-host"]:not([style*="display: none"])'
      );
      if (!host) return null;
      const col = host.querySelector('.cm-lineNumberColumn');
      if (!col) return null;
      const colRect = col.getBoundingClientRect();
      const byText = new Map<string, DOMRect>();
      for (const ln of Array.from(host.querySelectorAll('.cm-line')) as HTMLElement[]) {
        byText.set((ln.textContent ?? '').trim(), ln.getBoundingClientRect());
      }
      let max = -1;
      let worst = '';
      for (const cell of Array.from(col.children) as HTMLElement[]) {
        if (cell.style.display === 'none') continue;
        const cr = cell.getBoundingClientRect();
        // Only judge cells actually inside the visible column strip.
        if (cr.bottom < colRect.top || cr.top > colRect.bottom) continue;
        const n = Number(cell.textContent);
        if (!Number.isFinite(n)) continue;
        if (n > il && n <= il + ins) continue; // an inserted (markerless) line
        const marker = n <= il ? `x${n};` : `x${n - ins};`;
        const lr = byText.get(marker);
        if (!lr) continue; // marker row not rendered (shouldn't happen mid-viewport)
        const d = Math.abs(cr.top - lr.top);
        if (d > max) {
          max = d;
          worst = `cell #${n} ↔ ${marker} cellTop=${cr.top} lineTop=${lr.top}`;
        }
      }
      return max >= 0 ? { max, worst } : null;
    },
    { insertLine, inserted }
  );
}

async function maxCellLineDelta(
  page: Pg,
  insertLine?: number,
  inserted?: number
): Promise<number | null> {
  const r = await cellLineReport(page, insertLine, inserted);
  return r === null ? null : r.max;
}

test('line numbers stay glued to their lines through inserts in a BigScaler-sized doc', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp();
  try {
    await page.waitForSelector('.cm-lineNumberColumn');
    await waitForSeam(page);
    await seedMarkerDoc(page, LINE_COUNT, 0);
    await focusEditor(page);

    // Jump deep into the document (line 250k) and let the viewport settle. End
    // puts the caret at the line's END so Enter inserts EMPTY lines below it —
    // keeping every marker's expected line number computable for pairing.
    const INSERT_LINE = 250_000;
    await page.evaluate((il) => {
      const hook = window.__notepadsTest!.editor!;
      const pos = hook.getDocText().indexOf(`x${il};`);
      hook.setSelection(pos, pos);
    }, INSERT_LINE);
    await page.keyboard.press('End');
    await expect.poll(() => maxCellLineDelta(page)).not.toBeNull();
    await expect.poll(() => maxCellLineDelta(page)).toBeLessThanOrEqual(1.5);

    // Insert lines via real Enter presses — each edit rescales every block.top
    // (BigScaler). The numbers must stay glued after every keypress.
    for (let k = 1; k <= 5; k++) {
      await page.keyboard.press('Enter');
      await expect
        .poll(() => maxCellLineDelta(page, INSERT_LINE, k))
        .toBeLessThanOrEqual(1.5);
    }

    // Type some text too (horizontal edit on a rescaled doc) and re-verify.
    await page.keyboard.type('inserted-text');
    await expect.poll(() => maxCellLineDelta(page, INSERT_LINE, 5)).toBeLessThanOrEqual(1.5);

    // Also verify near EOF, where scroll-anchor compensation is largest. The
    // trailing Enter adds a markerless line at the very end — the same
    // (INSERT_LINE, 5) mapping still holds for every marker line.
    await page.keyboard.press('Control+End');
    await expect.poll(() => maxCellLineDelta(page, INSERT_LINE, 5)).toBeLessThanOrEqual(1.5);
    await page.keyboard.press('Enter');
    await expect.poll(() => maxCellLineDelta(page, INSERT_LINE, 5)).toBeLessThanOrEqual(1.5);
  } finally {
    await app.close();
  }
});

test('digit-count growth (5 → 6 digits) re-reserves the column without breaking alignment', async () => {
  const { app, page } = await launchApp();
  try {
    await page.waitForSelector('.cm-lineNumberColumn');
    await waitForSeam(page);
    // 99,999 lines: one more line crosses 5 → 6 digits, forcing a column-width
    // re-reserve (marginLeft write) — the path that used to thrash CM6's
    // measure loop ("Viewport failed to stabilize").
    await seedMarkerDoc(page, 99_999, 'end');
    await focusEditor(page);
    await page.keyboard.press('Control+End');
    await expect.poll(() => maxCellLineDelta(page)).not.toBeNull();

    const widthBefore = await page.evaluate(
      () => (document.querySelector('.cm-lineNumberColumn') as HTMLElement).style.width
    );
    await page.keyboard.press('Enter'); // line 100,000 → 6 digits
    await expect.poll(() => maxCellLineDelta(page, 99_999, 1)).toBeLessThanOrEqual(1.5);
    await expect
      .poll(() =>
        page.evaluate(
          () => (document.querySelector('.cm-lineNumberColumn') as HTMLElement).style.width
        )
      )
      .not.toBe(widthBefore);
  } finally {
    await app.close();
  }
});
