import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, safeRm, type LaunchedApp } from './helpers/launch';

/**
 * VERIFICATION GATE 6 — line 2: cross-window tab transfer (docs/plan/06 §6.A
 * cross-window + §GATE 6). THE hard line.
 *
 *   "Drag a dirty tab from window 1 to window 2 → window 2 adopts the FULL state
 *    (including the pending dirty buffer), window 1 RELEASES it, and the adopted
 *    tab's undo history resets to baseline. Titled/dirty dropped to void = no-op;
 *    untitled-clean dropped to void spawns a blank window."
 *
 * Drives the GENUINE transfer path through the documented `window.__notepadsTest
 * .transfer` seam (lane-a, src/renderer/tabs/transferWiring.ts). The raw HTML5
 * cross-process drag is unsynthesizable in Playwright, so the seam invokes the
 * SAME path the real drag handler calls — it does NOT bypass the contract:
 *   transfer.begin(editorId)       → buildEnvelope + window.notepads.dragOut.begin → token
 *   transfer.complete(token, idx)  → window.notepads.dragOut.complete (MAIN routes adopt/release)
 *   transfer.voidDrop(editorId)    → the UWP SetDraggedOutside rule (no-op vs spawn)
 * MAIN then pushes editor.onAdopt to the target (applyAdopt seeds a fresh doc) and
 * editor.onRelease to the source (applyRelease drops the tab).
 *
 * TWO WINDOWS: the broker spawns a second BrowserWindow on the SAME app handle
 * (alwaysOpenNewWindow ON + forceNewWindow), so `app.windows()` exposes both Pages
 * and the spec asserts each side independently — all within one e2e process (the
 * single-instance lock is intentionally skipped under NOTEPADS_E2E, see broker.e2e.ts).
 *
 * R10 LESSON: the transfer arbitration (token table, adopt/release routing) is
 * MAIN-owned; we drive it via the real contract through the seam, never by faking
 * a renderer drop.
 */

/** Open a second window via the broker and return its Page. */
async function spawnSecondWindow(app: LaunchedApp): Promise<Page> {
  // alwaysOpenNewWindow ON makes the next broker request spawn rather than redirect.
  await app.page.evaluate(() => window.notepads.settings.set({ alwaysOpenNewWindow: true }));
  const pending = app.app.waitForEvent('window', { timeout: 10_000 });
  await app.page.evaluate(() =>
    window.notepads.window.brokerRequest({ paths: [], forceNewWindow: true })
  );
  const win = await pending;
  await win.waitForLoadState('domcontentloaded');
  return win;
}

/**
 * Open `filePath` into a fresh tab in `page`, then make a GENUINE dirty edit via
 * the editor seam (insertAsPaste) so the live CM6 doc carries pending text the
 * envelope will pick up. Returns the editorId.
 */
async function seedDirtyBackedTab(page: Page, filePath: string, edit: string): Promise<string> {
  return page.evaluate(
    async ([fp, dirty]) => {
      const r = await window.__notepadsTest.openFileIntoEditor(fp);
      if (!r.ok) throw new Error(r.error ?? 'openFileIntoEditor failed');
      const seam = window.__notepadsTest.tabs!;
      const id = seam.activeId()!;
      // A real edit: focus + paste appends text in one transaction → dirties the
      // doc AND grows the source's undo history (so we can prove the TARGET resets).
      window.__notepadsTest.editor!.focus();
      window.__notepadsTest.editor!.insertAsPaste(dirty);
      seam.setModified(id, true);
      return id;
    },
    [filePath, edit] as const
  );
}

/** Count tabs in a window via the seam. */
async function tabCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__notepadsTest.tabs?.count() ?? 0);
}

/** Whether `editorId` is present in `page`'s tab list. */
async function hasTab(page: Page, editorId: string): Promise<boolean> {
  return page.evaluate(
    (id) => !!window.__notepadsTest.tabs?.list().some((t) => t.editorId === id),
    editorId
  );
}

/** Run the genuine transfer via the seam: begin on SOURCE, complete on TARGET. */
async function transfer(
  source: Page,
  target: Page,
  editorId: string,
  dropIndex: number
): Promise<void> {
  const token = await source.evaluate(async (id) => {
    const t = await window.__notepadsTest.transfer!.begin(id);
    return t;
  }, editorId);
  if (!token)
    throw new Error('transfer.begin returned null (envelope build / dragOut.begin failed)');
  const ok = await target.evaluate(
    async ([tok, idx]) => window.__notepadsTest.transfer!.complete(tok as string, idx as number),
    [token, dropIndex] as const
  );
  if (!ok) throw new Error('transfer.complete returned false (dragOut.complete failed)');
}

test.describe('Gate 6 — cross-window tab transfer', () => {
  test('drag a dirty tab w1 → w2: full state adopted, source releases, undo resets', async () => {
    const userDataDir = makeUserDataDir('np-transfer-happy');
    const dir = mkdtempSync(join(tmpdir(), 'np-transfer-'));
    const file = join(dir, 'moved.txt');
    writeFileSync(file, 'baseline body\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      const w2 = await spawnSecondWindow(app);

      const editorId = await seedDirtyBackedTab(w1, file, 'DIRTY EDIT');

      await transfer(w1, w2, editorId, 0);

      // TARGET adopted the FULL state incl. the pending dirty buffer. applyAdopt
      // MINTS A FRESH local editorId on the target (R3 / #20) — it deliberately does
      // NOT reuse the source id (which would collide with w2's pre-existing blank
      // tab, also editor-1, and drop the adopted doc). So the adopted tab is NOT
      // keyed by `editorId`; adopt activates the new tab, so resolve it via the
      // active tab id and assert against THAT. (Asserting `editorId` here would read
      // w2's leftover blank editor-1 and wrongly see mod=false.)
      await expect
        .poll(
          () =>
            w2.evaluate(
              (fp) => window.__notepadsTest.tabs?.list().some((t) => t.filePath === fp),
              file
            ),
          {
            timeout: 10_000
          }
        )
        .toBe(true);
      const adoptedId = await w2.evaluate(() => window.__notepadsTest.tabs?.activeId() ?? null);
      expect(adoptedId, 'adopt activates the freshly-minted local tab').not.toBe(null);
      const adoptedText = await w2.evaluate(() => window.__notepadsTest.getEditorDocText());
      expect(adoptedText).toContain('DIRTY EDIT');
      const adoptedDirty = await w2.evaluate(
        (id) => !!window.__notepadsTest.tabs?.list().find((t) => t.editorId === id)?.isModified,
        adoptedId
      );
      expect(adoptedDirty, 'adopted tab keeps its dirty flag').toBe(true);
      // The adopted tab carries the source file path (full-state adopt).
      const adoptedPath = await w2.evaluate(
        (id) => window.__notepadsTest.tabs?.list().find((t) => t.editorId === id)?.filePath ?? null,
        adoptedId
      );
      expect(adoptedPath, 'adopted tab carries the source file path').toBe(file);

      // SOURCE released the tab. In w1 the source tab keeps its own id (`editorId`),
      // so the release check is valid against the source id here.
      await expect.poll(() => hasTab(w1, editorId), { timeout: 10_000 }).toBe(false);

      // Undo history reset to baseline in the adopted tab (no cross-window undo bleed):
      // the source had >=1 undoable step from the paste; the adopted tab seeds fresh.
      const undoDepth = await w2.evaluate(() => window.__notepadsTest.editor?.undoDepth() ?? -1);
      expect(undoDepth, 'adopted tab undo history resets to baseline (0)').toBe(0);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('titled + dirty tab dropped to void is a no-op (tab stays put)', async () => {
    const userDataDir = makeUserDataDir('np-transfer-void-noop');
    const dir = mkdtempSync(join(tmpdir(), 'np-transfer-void-'));
    const file = join(dir, 'stays.txt');
    writeFileSync(file, 'keep me\n', 'utf8');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      const editorId = await seedDirtyBackedTab(w1, file, 'EDIT');
      const before = await tabCount(w1);

      // Void-drop rule: a titled OR dirty tab must NOT be flung out (data-loss guard).
      // The seam returns false (no-op) and the tab stays put.
      const acted = await w1.evaluate(
        (id) => window.__notepadsTest.transfer!.voidDrop(id),
        editorId
      );
      expect(acted, 'void-drop on a titled/dirty tab is a no-op').toBe(false);
      expect(await hasTab(w1, editorId)).toBe(true);
      expect(await tabCount(w1)).toBe(before);
    } finally {
      await app.app.close();
      safeRm(dir);
      safeRm(userDataDir);
    }
  });

  test('untitled + clean tab dropped to void spawns a blank window', async () => {
    const userDataDir = makeUserDataDir('np-transfer-void-spawn');
    const app = await launchApp({ userDataDir });
    try {
      const w1 = app.page;
      // The void-drop rule only flings out a tab that is NOT the last one, so seed a
      // second untitled+clean tab and fling THAT (the first stays as the anchor).
      await w1.evaluate(() => window.__notepadsTest.tabs!.newTab());
      const editorId = await w1.evaluate(() => window.__notepadsTest.tabs!.activeId()!);
      expect(await tabCount(w1)).toBeGreaterThan(1);
      const before = app.app.windows().length;

      // Untitled + clean + not-last dropped to void: UWP SetDraggedOutside spawns a
      // fresh blank window (tear-off) via brokerRequest and removes the tab here.
      const pending = app.app.waitForEvent('window', { timeout: 10_000 });
      const acted = await w1.evaluate(
        (id) => window.__notepadsTest.transfer!.voidDrop(id),
        editorId
      );
      expect(acted, 'void-drop on an untitled/clean non-last tab spawns').toBe(true);
      const spawned = await pending;
      await spawned.waitForLoadState('domcontentloaded');
      expect(app.app.windows().length).toBe(before + 1);
      // The flung tab was removed from the source window.
      expect(await hasTab(w1, editorId)).toBe(false);
    } finally {
      await app.app.close();
      safeRm(userDataDir);
    }
  });
});
