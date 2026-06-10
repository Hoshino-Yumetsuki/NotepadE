import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * Open-loading state (task #5): opening a file must surface its tab IMMEDIATELY
 * (title = basename, spinner in the editor area) instead of leaving the window
 * on the previous/new-file UI until MAIN finishes the whole read+decode+IPC
 * pipeline. Uses a large generated temp file so the read is slow enough for the
 * loading state to be observable, then asserts the content lands and the
 * spinner clears. Dialog stubbed exactly like file-io-smoke.e2e.ts.
 */

const LARGE_LINE = 'The quick brown fox jumps over the lazy dog. 0123456789\n';
/** ~56MB — large enough that read+decode is observably async, small enough to stay fast. */
const LARGE_REPEATS = 1_000_000;

async function activeTab(
  app: LaunchedApp
): Promise<{ filePath: string | null; title: string } | null> {
  return app.page.evaluate(() => {
    const seam = window.__notepadsTest?.tabs;
    if (!seam) return null;
    const id = seam.activeId();
    const t = seam.list().find((tab) => tab.editorId === id);
    return t ? { filePath: t.filePath, title: t.title } : null;
  });
}

/** Stub MAIN's native open dialog to return `paths` (same shape as file-io-smoke). */
async function stubOpenDialog(app: LaunchedApp, paths: string[]): Promise<void> {
  await app.app.evaluate(async (electron, picked) => {
    electron.dialog.showOpenDialog = (async () => ({
      canceled: picked.length === 0,
      filePaths: picked
    })) as typeof electron.dialog.showOpenDialog;
  }, paths);
}

test.describe('open loading state — tab + spinner appear before the read finishes', () => {
  test('large-file open shows the named tab with a spinner, then the content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-open-loading-'));
    const file = join(dir, 'huge-loading-target.txt');
    writeFileSync(file, LARGE_LINE.repeat(LARGE_REPEATS), 'utf8');
    const userDataDir = makeUserDataDir('np-open-loading');
    const app = await launchApp({ userDataDir });
    try {
      await stubOpenDialog(app, [file]);
      await app.page.getByTestId('editor-host').first().click();
      await app.page.keyboard.press('Control+o');

      // IMMEDIATELY (before the ~56MB read+decode+IPC completes): the active tab
      // already carries the file path/basename and the editor area shows the
      // loading spinner instead of the editor surface.
      await expect
        .poll(async () => (await activeTab(app))?.filePath ?? null, { timeout: 5_000 })
        .toBe(file);
      const seen = await activeTab(app);
      expect(seen?.title).toBe('huge-loading-target.txt');
      await expect(app.page.getByTestId('editor-loading')).toBeVisible();

      // Then the pipeline finishes: spinner clears, editor mounts with content,
      // and the freshly-loaded doc is clean (not dirty).
      await expect(app.page.getByTestId('editor-loading')).toHaveCount(0, { timeout: 45_000 });
      await expect
        .poll(() => app.page.evaluate(() => window.__notepadsTest.getEditorDocText().length), {
          timeout: 20_000
        })
        .toBeGreaterThan(LARGE_LINE.length * (LARGE_REPEATS - 1));
      const dirty = await app.page.evaluate(() => {
        const seam = window.__notepadsTest.tabs;
        const id = seam.activeId();
        return seam.list().find((t) => t.editorId === id)?.isModified ?? null;
      });
      expect(dirty).toBe(false);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('small-file open still lands content and ends not-loading', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-open-loading-small-'));
    const file = join(dir, 'small-target.txt');
    writeFileSync(file, 'small open content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-open-loading-small');
    const app = await launchApp({ userDataDir });
    try {
      await stubOpenDialog(app, [file]);
      await app.page.getByTestId('editor-host').first().click();
      await app.page.keyboard.press('Control+o');
      await expect
        .poll(async () => (await activeTab(app))?.filePath ?? null, { timeout: 10_000 })
        .toBe(file);
      // The spinner for a tiny file may flash for a frame or not at all — only
      // the END state is contractual: no spinner, content present, clean tab.
      await expect(app.page.getByTestId('editor-loading')).toHaveCount(0, { timeout: 10_000 });
      await expect
        .poll(() => app.page.evaluate(() => window.__notepadsTest.getEditorDocText()), {
          timeout: 10_000
        })
        .toContain('small open content');
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });
});
