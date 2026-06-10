import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * Memory regression (task #6): closing a large-file tab must release the
 * document. Two confirmed historical leaks this guards:
 *   1. App.tsx lastSavedTextRef — closes that bypass performClose (closeOthers /
 *      closeToRight / closeSaved / cross-window release / void-drop) left the
 *      full per-tab baseline string in the map forever (~100MB retained per
 *      closed 100MB file).
 *   2. CodeMirrorEditor unmount cleanup — docRef re-capture used doc.toString(),
 *      materializing a full-size transient string copy on EVERY unmount
 *      including the final close (the user-visible close-time heap spike).
 *
 * GC is forced via CDP HeapProfiler.collectGarbage (no --js-flags needed), then
 * the post-close heap is asserted back near baseline. The threshold (40MB over
 * baseline) is far above normal noise (~2MB measured) and far below the leak
 * size (~110MB), so the test is stable in both directions.
 */

const LINE = 'The quick brown fox jumps over the lazy dog. 0123456789\n';
const REPEATS = 2_000_000; // ~112MB document
const RETAINED_LIMIT_BYTES = 40 * 1024 * 1024;

async function stubOpenDialog(app: LaunchedApp, paths: string[]): Promise<void> {
  await app.app.evaluate(async (electron, picked) => {
    electron.dialog.showOpenDialog = (async () => ({
      canceled: picked.length === 0,
      filePaths: picked
    })) as typeof electron.dialog.showOpenDialog;
  }, paths);
}

/** Force a full GC via CDP, then read the renderer's used JS heap (bytes). */
async function gcAndHeap(app: LaunchedApp): Promise<number> {
  const client = await app.page.context().newCDPSession(app.page);
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.collectGarbage');
  await app.page.waitForTimeout(500);
  await client.send('Performance.enable');
  const { metrics } = await client.send('Performance.getMetrics');
  await client.detach();
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? -1;
}

/** Open `file` via the stubbed dialog and wait until the FULL doc has landed. */
async function openAndAwaitDoc(app: LaunchedApp, file: string): Promise<void> {
  await stubOpenDialog(app, [file]);
  await app.page.getByTestId('editor-host').first().click();
  await app.page.keyboard.press('Control+o');
  await expect
    .poll(() => app.page.evaluate(() => window.__notepadsTest.getEditorDocText().length), {
      timeout: 90_000
    })
    .toBeGreaterThan(LINE.length * (REPEATS - 1));
}

/** Seam poll: no file-backed tab remains open. */
async function expectNoFileTabs(app: LaunchedApp): Promise<void> {
  await expect
    .poll(() =>
      app.page.evaluate(
        () => window.__notepadsTest.tabs.list().filter((t) => t.filePath !== null).length
      )
    )
    .toBe(0);
}

const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

test.describe('memory — closing a large-file tab releases the document', () => {
  test('Ctrl+W close returns the heap to baseline', async () => {
    test.setTimeout(180_000);
    const dir = mkdtempSync(join(tmpdir(), 'np-mem-close-'));
    const file = join(dir, 'mem-close.txt');
    writeFileSync(file, LINE.repeat(REPEATS), 'utf8');
    const userDataDir = makeUserDataDir('np-mem-close');
    const app = await launchApp({ userDataDir });
    try {
      const baseline = await gcAndHeap(app);
      await openAndAwaitDoc(app, file);
      const afterOpen = await gcAndHeap(app);
      // Sanity: the document really is resident (~112MB) before the close.
      expect(afterOpen - baseline).toBeGreaterThan(100 * 1024 * 1024);

      await app.page.keyboard.press('Control+w');
      await expectNoFileTabs(app);
      const afterClose = await gcAndHeap(app);

      console.log(
        `[MEM ctrl+w] baseline=${mb(baseline)}MB afterOpen=${mb(afterOpen)}MB afterClose+gc=${mb(afterClose)}MB retained=${mb(afterClose - baseline)}MB`
      );
      expect(afterClose - baseline).toBeLessThan(RETAINED_LIMIT_BYTES);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('closeOthers (store path that bypasses performClose) returns the heap to baseline', async () => {
    test.setTimeout(180_000);
    const dir = mkdtempSync(join(tmpdir(), 'np-mem-closeothers-'));
    const file = join(dir, 'mem-closeothers.txt');
    writeFileSync(file, LINE.repeat(REPEATS), 'utf8');
    const userDataDir = makeUserDataDir('np-mem-closeothers');
    const app = await launchApp({ userDataDir });
    try {
      const baseline = await gcAndHeap(app);
      await openAndAwaitDoc(app, file);

      // Close the FILE tab via the context-menu store path: create an untitled
      // tab, then closeOthers(untitled) — this skips performClose entirely, the
      // path that historically leaked the lastSavedTextRef baseline.
      await app.page.evaluate(() => {
        const seam = window.__notepadsTest.tabs;
        const untitled = seam.newTab();
        seam.closeOthers(untitled);
      });
      await expectNoFileTabs(app);
      const afterClose = await gcAndHeap(app);

      console.log(
        `[MEM closeOthers] baseline=${mb(baseline)}MB afterClose+gc=${mb(afterClose)}MB retained=${mb(afterClose - baseline)}MB`
      );
      expect(afterClose - baseline).toBeLessThan(RETAINED_LIMIT_BYTES);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });
});
