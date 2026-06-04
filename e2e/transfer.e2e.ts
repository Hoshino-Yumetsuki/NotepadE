import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, type LaunchedApp } from './helpers/launch';
import type { DragEnvelope } from '../src/shared/ipc-contract';

/**
 * VERIFICATION GATE 6 — line 2: cross-window tab transfer (docs/plan/06 §6.A
 * cross-window + §GATE 6). THE hard line.
 *
 *   "Drag a dirty tab from window 1 to window 2 → window 2 adopts the FULL state
 *    (including the pending dirty buffer), window 1 RELEASES it, and the adopted
 *    tab's undo history resets to baseline. Titled/dirty dropped to void = no-op;
 *    untitled-clean dropped to void spawns a blank window."
 *
 * Drives the GENUINE transfer path through the frozen contract:
 *   window 1: dragOut.begin(envelope) → token
 *   window 2: dragOut.complete(token, dropIndex)
 *             → MAIN pushes editor.onAdopt to window 2 (full OpenedFile + pendingText)
 *             → MAIN pushes editor.onRelease to window 1 (source drops the tab)
 *
 * TWO WINDOWS: the app's broker (alwaysOpenNewWindow ON, or a seam) gives a second
 * BrowserWindow on the SAME app handle; `app.windows()` / `app.waitForEvent('window')`
 * expose both Pages so the spec can assert state on each side independently.
 *
 * R10 LESSON: the transfer arbitration (token table, adopt/release routing) is
 * MAIN-owned. We drive it via the real dragOut/editor contract, NOT by faking a
 * renderer drop. If the raw HTML5 DnD cannot be SYNTHESIZED in Playwright (Electron
 * drag events are notoriously unsynthesizable), this spec uses the documented
 * `window.__notepadsTest.transfer` seam (requested from lane-a) to invoke the SAME
 * dragOut.begin/complete contract the real drag handler calls — the seam orchestrates
 * the genuine IPC, it does not bypass it.
 *
 * SCAFFOLD STATE: authored against the frozen dragOut/editor contract + the requested
 * transfer seam. The transfer impl (token table, adopt/release, undo reset) lands with
 * 6.A; until then these are `test.fixme` so the spec COMPILES + is discovered without
 * redding the suite. FINALIZE STEP: flip `test.fixme` → `test` once lane-a reports the
 * transfer path + (if needed) the __notepadsTest.transfer seam merged.
 */

/** Open a second window via the broker and return its Page. */
async function spawnSecondWindow(app: LaunchedApp): Promise<Page> {
  // alwaysOpenNewWindow ON makes the next broker request spawn rather than redirect.
  await app.page.evaluate(() => window.notepads.settings.set({ alwaysOpenNewWindow: true }));
  const pending = app.app.waitForEvent('window', { timeout: 10_000 });
  await app.page.evaluate(() => window.notepads.window.brokerRequest({ paths: [], forceNewWindow: true }));
  const win = await pending;
  await win.waitForLoadState('domcontentloaded');
  return win;
}

/** Seed a dirty, file-backed tab in `page` and return its editorId + envelope-ish state. */
async function seedDirtyBackedTab(page: Page, filePath: string): Promise<string> {
  await page.evaluate(() => window.__notepadsTest.tabs?.newTab());
  const editorId = await page.evaluate(async (fp) => {
    const r = await window.__notepadsTest.openFileIntoEditor(fp);
    if (!r.ok) throw new Error(r.error);
    const seam = window.__notepadsTest.tabs!;
    const id = seam.activeId()!;
    // Make it dirty: append text + mark modified through the genuine store.
    seam.setModified(id, true);
    return id;
  }, filePath);
  return editorId;
}

/** Count tabs in a window via the seam. */
async function tabCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__notepadsTest.tabs?.count() ?? 0);
}

/** Whether `editorId` is present in `page`'s tab list. */
async function hasTab(page: Page, editorId: string): Promise<boolean> {
  return page.evaluate((id) => !!window.__notepadsTest.tabs?.list().some((t) => t.editorId === id), editorId);
}

/** Run the genuine transfer (begin in source → complete in target) via the seam. */
async function transfer(
  source: Page,
  target: Page,
  envelope: DragEnvelope,
  dropIndex: number,
): Promise<void> {
  // begin() on the SOURCE returns a token; complete() on the TARGET adopts it.
  const token = await source.evaluate(async (env) => {
    const r = await window.notepads.dragOut.begin(env as never);
    if (!r.ok) throw new Error(`dragOut.begin: ${r.error}`);
    return r.data.token;
  }, envelope);
  const done = await target.evaluate(
    async ([tok, idx]) => {
      const r = await window.notepads.dragOut.complete(tok as string, idx as number);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [token, dropIndex] as const,
  );
  if (!done.ok) throw new Error(`dragOut.complete: ${done.error}`);
}

function makeEnvelope(over: Partial<DragEnvelope> & Pick<DragEnvelope, 'editorId'>): DragEnvelope {
  return {
    sourceWindowId: 0,
    filePath: null,
    lastSavedText: '',
    pendingText: null,
    encodingId: 'UTF-8',
    eolId: 'lf',
    isModified: false,
    fileNamePlaceholder: 'Untitled',
    dateModifiedMs: 0,
    viewMode: { preview: false, diff: false },
    ...over,
  };
}

test.describe('Gate 6 — cross-window tab transfer', () => {
  test.fixme('drag a dirty tab w1 → w2: full state adopted, source releases, undo resets', async () => {
    const userDataDir = makeUserDataDir('np-transfer-happy');
    const dir = mkdtempSync(join(tmpdir(), 'np-transfer-'));
    const file = join(dir, 'moved.txt');
    writeFileSync(file, 'baseline body\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      const w2 = await spawnSecondWindow(app);

      const editorId = await seedDirtyBackedTab(w1, file);
      const envelope = makeEnvelope({
        editorId,
        filePath: file,
        lastSavedText: 'baseline body\n',
        pendingText: 'baseline body\nDIRTY EDIT',
        isModified: true,
      });

      await transfer(w1, w2, envelope, 0);

      // TARGET adopted the FULL state incl. the pending dirty buffer.
      await expect.poll(() => hasTab(w2, editorId), { timeout: 10_000 }).toBe(true);
      const adoptedText = await w2.evaluate(() => window.__notepadsTest.getEditorDocText());
      expect(adoptedText).toContain('DIRTY EDIT');
      const adoptedDirty = await w2.evaluate(
        (id) => !!window.__notepadsTest.tabs?.list().find((t) => t.editorId === id)?.isModified,
        editorId,
      );
      expect(adoptedDirty, 'adopted tab keeps its dirty flag').toBe(true);

      // SOURCE released the tab.
      await expect.poll(() => hasTab(w1, editorId), { timeout: 10_000 }).toBe(false);

      // Undo history reset to baseline in the adopted tab (no cross-window undo bleed).
      const undoDepth = await w2.evaluate(() => window.__notepadsTest.editor?.undoDepth() ?? -1);
      expect(undoDepth, 'adopted tab undo history resets to baseline (0)').toBe(0);
    } finally {
      await app.app.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test.fixme('titled + dirty tab dropped to void is a no-op (tab stays put)', async () => {
    const userDataDir = makeUserDataDir('np-transfer-void-noop');
    const dir = mkdtempSync(join(tmpdir(), 'np-transfer-void-'));
    const file = join(dir, 'stays.txt');
    writeFileSync(file, 'keep me\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      const editorId = await seedDirtyBackedTab(w1, file);
      const before = await tabCount(w1);

      // begin() then DON'T complete in any target → drop landed on void. The source
      // must NOT release a titled/dirty tab (data-loss guard): the tab stays put.
      await w1.evaluate(async (env) => {
        const r = await window.notepads.dragOut.begin(env as never);
        if (!r.ok) throw new Error(r.error);
        // void = no completion; (real handler times out / cancels the token)
      }, makeEnvelope({ editorId, filePath: file, isModified: true, pendingText: 'keep me\nEDIT' }));

      expect(await hasTab(w1, editorId)).toBe(true);
      expect(await tabCount(w1)).toBe(before);
    } finally {
      await app.app.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test.fixme('untitled + clean tab dropped to void spawns a blank window', async () => {
    const userDataDir = makeUserDataDir('np-transfer-void-spawn');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      const editorId = await w1.evaluate(() => window.__notepadsTest.tabs!.newTab());
      const before = app.app.windows().length;

      // Untitled + clean dragged to void: UWP semantics SPAWN a fresh blank window
      // carrying the tab (tear-off), rather than the data-loss-guard no-op.
      const pending = app.app.waitForEvent('window', { timeout: 10_000 });
      await w1.evaluate(async (env) => {
        const r = await window.notepads.dragOut.begin(env as never);
        if (!r.ok) throw new Error(r.error);
      }, makeEnvelope({ editorId, filePath: null, isModified: false, fileNamePlaceholder: 'Untitled' }));
      const spawned = await pending;
      await spawned.waitForLoadState('domcontentloaded');
      expect(app.app.windows().length).toBe(before + 1);
    } finally {
      await app.app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
