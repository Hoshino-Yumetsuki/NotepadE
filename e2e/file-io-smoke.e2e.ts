import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * TEMP smoke (worker-renderer task #2): Open (Ctrl+O), New Window (Ctrl+Shift+N),
 * Open Recent submenu. Native open dialog blocks the MAIN process, so we stub
 * `dialog.showOpenDialog` in MAIN (returns our temp file) and drive the genuine
 * renderer accelerator → file.openDialog → openPathIntoTab path. New Window goes
 * through the real broker. Drag-drop is NOT synthesized: webUtils.getPathForFile
 * returns '' for a fabricated DataTransfer File (no backing path), so a fake drop
 * is a no-op by design — its open primitive (openPathIntoTab) is the SAME one the
 * Open-dialog smoke exercises.
 */

async function activeFilePath(app: LaunchedApp): Promise<string | null> {
  return app.page.evaluate(() => {
    const seam = window.__notepadsTest?.tabs;
    if (!seam) return null;
    const id = seam.activeId();
    return seam.list().find((t) => t.editorId === id)?.filePath ?? null;
  });
}

async function windowCount(app: LaunchedApp): Promise<number> {
  return app.app.evaluate(() => {
    const seam = (globalThis as { __notepadsMainTest?: { windowCount(): number } })
      .__notepadsMainTest;
    if (!seam) throw new Error('__notepadsMainTest seam missing');
    return seam.windowCount();
  });
}

/** Number of tabs whose filePath equals `file` (for the dedup assertion). */
async function tabsForPath(app: LaunchedApp, file: string): Promise<number> {
  return app.page.evaluate((target) => {
    const seam = window.__notepadsTest?.tabs;
    if (!seam) return 0;
    return seam.list().filter((t) => t.filePath === target).length;
  }, file);
}

/** Stub MAIN's native open dialog to return `paths` (or [] for a cancel). */
async function stubOpenDialog(app: LaunchedApp, paths: string[]): Promise<void> {
  await app.app.evaluate(async (electron, picked) => {
    electron.dialog.showOpenDialog = (async () => ({
      canceled: picked.length === 0,
      filePaths: picked
    })) as typeof electron.dialog.showOpenDialog;
  }, paths);
}

test.describe('file-io smoke — open / new window / open recent', () => {
  test('Ctrl+O opens the dialog-chosen file into a new tab', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-fileio-open-'));
    const file = join(dir, 'opened-by-dialog.txt');
    writeFileSync(file, 'dialog open content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-fileio-open');
    const app = await launchApp({ userDataDir });
    try {
      await stubOpenDialog(app, [file]);
      // Focus the renderer first so OS-synthesized keys land on the webContents.
      await app.page.getByTestId('editor-host').first().click();
      await app.page.keyboard.press('Control+o');
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
      const text = await app.page.evaluate(() => window.__notepadsTest.getEditorDocText());
      expect(text).toContain('dialog open content');
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('opening an already-open file focuses the existing tab (no duplicate)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-fileio-dedup-'));
    const file = join(dir, 'dedupe-target.txt');
    writeFileSync(file, 'dedupe content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-fileio-dedup');
    const app = await launchApp({ userDataDir });
    try {
      await stubOpenDialog(app, [file]);
      await app.page.getByTestId('editor-host').first().click();
      // First open lands the file in a tab.
      await app.page.keyboard.press('Control+o');
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
      expect(await tabsForPath(app, file)).toBe(1);
      // Switch to a different (untitled) tab so re-open must re-focus, not no-op.
      await app.page.keyboard.press('Control+t');
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(null);
      // Second open of the SAME path focuses the existing tab — no duplicate.
      await app.page.keyboard.press('Control+o');
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);
      expect(await tabsForPath(app, file)).toBe(1);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('Ctrl+Shift+N spawns a second window via the broker', async () => {
    const userDataDir = makeUserDataDir('np-fileio-newwin');
    const app = await launchApp({ userDataDir });
    try {
      expect(await windowCount(app)).toBe(1);
      await app.page.getByTestId('editor-host').first().click();
      await app.page.keyboard.press('Control+Shift+N');
      await expect.poll(() => windowCount(app), { timeout: 10_000 }).toBe(2);
    } finally {
      await app.app.close();
      safeRm(userDataDir);
    }
  });

  test('Open Recent submenu lists a previously-opened file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'np-fileio-recent-'));
    const file = join(dir, 'recent-target.txt');
    writeFileSync(file, 'recent content\n', 'utf8');
    const userDataDir = makeUserDataDir('np-fileio-recent');
    const app = await launchApp({ userDataDir });
    try {
      // Open the file (Ctrl+O) so MAIN's file.open → addRecent records it in the MRU.
      await stubOpenDialog(app, [file]);
      await app.page.getByTestId('editor-host').first().click();
      await app.page.keyboard.press('Control+o');
      await expect.poll(() => activeFilePath(app), { timeout: 10_000 }).toBe(file);

      // Open the main menu flyout (refreshes recent via recent.list), then the
      // Open Recent submenu, and assert our file is listed.
      await app.page.getByTestId('main-menu-button').click();
      await app.page.getByTestId('open-recent').click();
      const items = app.page.getByTestId('open-recent-item');
      await expect(items.filter({ hasText: 'recent-target.txt' })).toBeVisible();
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  // Drag-drop scoping. A real OS-file drop can't be synthesized in Playwright
  // (webUtils.getPathForFile returns '' for a fabricated File with no backing
  // path — same reason broker.e2e drives no fake drop), so we assert the listener
  // CONTRACT instead: an OS-file dragover is preventDefaulted (so the drop fires
  // → openPathIntoTab), while a cross-window transfer token drag (types lacks
  // 'Files') is left untouched so dnd-kit reorder + the transfer token still work.
  test('drag-drop listeners target OS-file drags only (transfer drag untouched)', async () => {
    const userDataDir = makeUserDataDir('np-fileio-drag');
    const app = await launchApp({ userDataDir });
    try {
      const result = await app.page.evaluate(() => {
        const tokenDt = new DataTransfer();
        tokenDt.setData('application/x-notepads-token', 'tok-123');
        const tokenEv = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: tokenDt
        });
        window.dispatchEvent(tokenEv);

        const fileEv = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: new DataTransfer()
        });
        Object.defineProperty(fileEv.dataTransfer, 'types', { value: ['Files'] });
        window.dispatchEvent(fileEv);

        return {
          tokenDragPrevented: tokenEv.defaultPrevented,
          fileDragPrevented: fileEv.defaultPrevented
        };
      });
      // Transfer token drag: NOT intercepted (dnd-kit / token drag preserved).
      expect(result.tokenDragPrevented).toBe(false);
      // OS-file drag: intercepted so the subsequent drop opens the file.
      expect(result.fileDragPrevented).toBe(true);
    } finally {
      await app.app.close();
      safeRm(userDataDir);
    }
  });
});
