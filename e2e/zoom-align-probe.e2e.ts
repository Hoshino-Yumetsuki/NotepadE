import { test, expect } from '@playwright/test';
import { launchApp } from './helpers/launch';
import { setEditorDoc, focusEditor } from './helpers/editor';

/**
 * DIAGNOSTIC PROBE 6 (temporary): WORD-WRAP + zoom, content-paired. Wrapped
 * blocks carry one number at the block top; pair each visible cell with the
 * .cm-line whose text starts with the matching marker and measure the delta.
 * Also dumps per-line box heights to expose variable-height lines (CJK
 * fallback stretch) at high zoom.
 */

test('probe6: wrap + zoom, content-paired', async () => {
  const { app, page } = await launchApp();
  try {
    await page.waitForSelector('.cm-lineNumberColumn');
    // Long wrapping lines with CJK mixed in.
    const doc = Array.from(
      { length: 120 },
      (_, i) => `L${i + 1}# 中文混排 ${'wrapword '.repeat(30)}`
    ).join('\n');
    await setEditorDoc(page, doc, 0);
    await focusEditor(page);

    // Word wrap ON via the real accelerator (Alt+Z).
    await page.keyboard.press('Alt+z');
    await page.waitForTimeout(400);

    const snap = async (label: string) =>
      page.evaluate((lbl) => {
        const host = document.querySelector(
          '[data-testid="editor-host"]:not([style*="display: none"])'
        )!;
        const content = host.querySelector('.cm-content') as HTMLElement;
        const col = host.querySelector('.cm-lineNumberColumn') as HTMLElement;
        const cells = (Array.from(col.children) as HTMLElement[]).filter(
          (c) => c.style.display !== 'none'
        );
        const lines = Array.from(content.querySelectorAll('.cm-line')) as HTMLElement[];
        const byMarker = new Map<string, HTMLElement>();
        for (const ln of lines) {
          const m = /^L(\d+)#/.exec(ln.textContent ?? '');
          if (m) byMarker.set(m[1], ln);
        }
        const colRect = col.getBoundingClientRect();
        const pairs = cells
          .map((cell) => {
            const cr = cell.getBoundingClientRect();
            if (cr.bottom < colRect.top || cr.top > colRect.bottom) return null; // offscreen cell
            const n = cell.textContent ?? '';
            const ln = byMarker.get(n);
            if (!ln) return { n, delta: 'NO LINE' as const };
            const lr = ln.getBoundingClientRect();
            return {
              n,
              cellTop: Math.round(cr.top * 100) / 100,
              lineTop: Math.round(lr.top * 100) / 100,
              delta: Math.round((cr.top - lr.top) * 100) / 100,
              blockH: Math.round(lr.height * 100) / 100,
              cellH: Math.round(cr.height * 100) / 100,
              cellLH: cell.style.lineHeight
            };
          })
          .filter(Boolean)
          .slice(0, 10);
        return {
          label: lbl,
          fontSize: getComputedStyle(content).fontSize,
          scrollTop: Math.round((host.querySelector('.cm-scroller') as HTMLElement).scrollTop)
        , pairs };
      }, label);

    const wrapped100 = await snap('wrap@100%');

    // Scroll deep then zoom to 160%.
    await page.evaluate(() => {
      const host = document.querySelector(
        '[data-testid="editor-host"]:not([style*="display: none"])'
      )!;
      (host.querySelector('.cm-scroller') as HTMLElement).scrollTop = 3000;
    });
    await page.waitForTimeout(300);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+=');
    await page.waitForTimeout(150);
    const justZoomed = await snap('wrap, scrolled, immediately after zoom to 160%');
    await page.waitForTimeout(1200);
    const settled = await snap('wrap settled +1.2s');

    console.log(JSON.stringify({ wrapped100, justZoomed, settled }, null, 2));
    expect(true).toBe(true);
  } finally {
    await app.close();
  }
});
