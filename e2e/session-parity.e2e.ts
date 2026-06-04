import { test, expect } from '@playwright/test';
import { rmSync, mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchApp, makeUserDataDir, type LaunchedApp } from './helpers/launch';
import type { SessionSnapshot, SessionTab } from '../src/shared/ipc-contract';

/**
 * VERIFICATION GATE 4 — session parity (docs/plan/05 §4.A + §GATE 4).
 *
 *   "Session parity: scripted dirty-kill → restart restores tab count, dirty
 *    flags, caret, scroll, encoding, view-mode exactly."
 *
 * This drives the GENUINE session manager (src/main/session.ts) end-to-end
 * through the frozen contract (window.notepads.session.*) and the real fs:
 *
 *   launch(userDataDir) → session.snapshot(snapshot+_backups) → app.close()
 *     → relaunch(SAME userDataDir) → session.loadLast() → assert restored state.
 *
 * The SAME deterministic userData dir is passed to both launches (the e2e helper
 * exports NOTEPADS_E2E_USERDATA, which MAIN applies via app.setPath BEFORE
 * whenReady), so the second process reads the FIRST process's
 * NotepadsSessionData.json + BackupFiles/ — modelling a dirty kill→restart.
 *
 * The renderer has no session UI wiring yet (Phase-4 integration is later), so
 * the harness calls window.notepads.session.* directly from the page. That is
 * the PA-8-clean contract surface — no raw ipcRenderer, no fs in the renderer —
 * and is exactly the seam Gate-4 must certify.
 */

/** A non-underscore SessionSnapshot plus the MAIN-only `_backups` sidecar. */
interface SnapshotWithBackups extends SessionSnapshot {
  _backups?: Record<string, { lastSaved?: string; pending?: string }>;
}

/** Persist a snapshot through the real contract; returns the write result. */
async function snapshot(
  app: LaunchedApp,
  data: SnapshotWithBackups,
): Promise<{ ok: boolean; written?: boolean; error?: string }> {
  return app.page.evaluate(async (d) => {
    const res = await window.notepads.session.snapshot(d as never);
    return res.ok ? { ok: true, written: res.data.written } : { ok: false, error: res.error };
  }, data);
}

/** Load the last session through the real contract. */
async function loadLast(app: LaunchedApp): Promise<SessionSnapshot | null> {
  const res = await app.page.evaluate(() => window.notepads.session.loadLast());
  if (!res.ok) throw new Error(`loadLast failed: ${res.error}`);
  return res.data;
}

/** Clear recovered backups through the real contract. */
async function clearRecovered(app: LaunchedApp): Promise<void> {
  const res = await app.page.evaluate(() => window.notepads.session.clearRecovered());
  if (!res.ok) throw new Error(`clearRecovered failed: ${res.error}`);
}

/** Build a fully-populated tab so every restored field is asserted. */
function makeTab(over: Partial<SessionTab> & Pick<SessionTab, 'editorId'>): SessionTab {
  return {
    filePath: null,
    encodingId: 'UTF-8',
    eolId: 'lf',
    isModified: false,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    viewMode: { preview: false, diff: false },
    ...over,
  };
}

test.describe('Gate 4 — session snapshot + crash recovery parity', () => {
  test('dirty-kill → restart restores tab count, dirty, caret, scroll, encoding, eol, view-mode', async () => {
    const userDataDir = makeUserDataDir('np-session-parity');

    // A real on-disk file so PA-4 re-validation PASSES for a backed tab.
    const fileDir = mkdtempSync(join(tmpdir(), 'np-session-file-'));
    const realFile = join(fileDir, 'kept.txt');
    writeFileSync(realFile, 'persisted content\n', 'utf8');

    const tabs: SessionTab[] = [
      // Backed, dirty, non-default caret/scroll/encoding/eol/view-mode.
      makeTab({
        editorId: 'ed-1',
        filePath: realFile,
        encodingId: 'UTF-16 LE BOM',
        eolId: 'crlf',
        isModified: true,
        selectionStart: 5,
        selectionEnd: 12,
        scrollTop: 240,
        viewMode: { preview: true, diff: false },
      }),
      // Untitled, clean, diff view on.
      makeTab({
        editorId: 'ed-2',
        filePath: null,
        encodingId: 'UTF-8-BOM',
        eolId: 'cr',
        isModified: false,
        selectionStart: 3,
        selectionEnd: 3,
        scrollTop: 17,
        viewMode: { preview: false, diff: true },
      }),
    ];

    const snap: SnapshotWithBackups = {
      version: 1,
      tabs,
      activeEditorId: 'ed-2',
      _backups: {
        'ed-1': { lastSaved: 'persisted content\n', pending: 'persisted content edited' },
        'ed-2': { lastSaved: 'untitled body' },
      },
    };

    // --- session 1: write the snapshot, then kill the app ---
    let app = await launchApp({ userDataDir });
    try {
      const w = await snapshot(app, snap);
      expect(w.ok, `snapshot failed: ${w.error}`).toBe(true);
      expect(w.written, 'first snapshot must hit disk').toBe(true);

      // Dirty-check parity: an identical re-snapshot must NOT rewrite disk.
      const w2 = await snapshot(app, snap);
      expect(w2.ok && w2.written, 'identical re-snapshot must be a no-op write').toBe(false);

      // The versioned session JSON + extension-less backups exist on disk.
      expect(existsSync(join(userDataDir, 'NotepadsSessionData.json'))).toBe(true);
      const backups = readdirSync(join(userDataDir, 'BackupFiles'));
      expect(backups).toContain('ed-1-LastSaved');
      expect(backups).toContain('ed-1-Pending'); // dirty tab keeps pending
      expect(backups).toContain('ed-2-LastSaved');
      expect(backups).not.toContain('ed-2-Pending'); // clean tab: no pending
    } finally {
      await app.app.close();
    }

    // --- session 2: restart against the SAME userData, restore + assert ---
    app = await launchApp({ userDataDir });
    try {
      const restored = await loadLast(app);
      expect(restored, 'loadLast returned null after a clean snapshot').not.toBeNull();
      if (!restored) return;

      expect(restored.version).toBe(1);
      expect(restored.activeEditorId).toBe('ed-2');
      expect(restored.tabs.map((t) => t.editorId)).toEqual(['ed-1', 'ed-2']); // tab count + order

      const r1 = restored.tabs[0];
      expect(r1.filePath).toBe(realFile);
      expect(r1.encodingId).toBe('UTF-16 LE BOM');
      expect(r1.eolId).toBe('crlf');
      expect(r1.isModified).toBe(true);
      expect(r1.selectionStart).toBe(5);
      expect(r1.selectionEnd).toBe(12);
      expect(r1.scrollTop).toBe(240);
      expect(r1.viewMode).toEqual({ preview: true, diff: false });
      expect(r1.unavailable ?? false, 'kept file must NOT be unavailable').toBe(false);

      const r2 = restored.tabs[1];
      expect(r2.filePath).toBeNull();
      expect(r2.encodingId).toBe('UTF-8-BOM');
      expect(r2.eolId).toBe('cr');
      expect(r2.isModified).toBe(false);
      expect(r2.selectionStart).toBe(3);
      expect(r2.scrollTop).toBe(17);
      expect(r2.viewMode).toEqual({ preview: false, diff: true });
    } finally {
      await app.app.close();
    }

    rmSync(fileDir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('PA-4: a file missing at restart marks the tab unavailable with path PRESERVED', async () => {
    const userDataDir = makeUserDataDir('np-session-pa4');
    const fileDir = mkdtempSync(join(tmpdir(), 'np-session-pa4-file-'));
    const doomedFile = join(fileDir, 'will-vanish.txt');
    writeFileSync(doomedFile, 'here for now\n', 'utf8');

    const snap: SnapshotWithBackups = {
      version: 1,
      tabs: [makeTab({ editorId: 'ed-x', filePath: doomedFile, isModified: false })],
      activeEditorId: 'ed-x',
      _backups: { 'ed-x': { lastSaved: 'here for now\n' } },
    };

    let app = await launchApp({ userDataDir });
    try {
      const w = await snapshot(app, snap);
      expect(w.ok && w.written).toBe(true);
    } finally {
      await app.app.close();
    }

    // The file disappears while the app is down (rename/move/delete).
    rmSync(doomedFile, { force: true });

    app = await launchApp({ userDataDir });
    try {
      const restored = await loadLast(app);
      expect(restored).not.toBeNull();
      const tab = restored?.tabs[0];
      expect(tab?.unavailable, 'missing file must mark the tab unavailable').toBe(true);
      // PA-4: path is PRESERVED (not nulled) so the UI can offer relocate/save-as.
      expect(tab?.filePath, 'unavailable tab must PRESERVE its filePath').toBe(doomedFile);
    } finally {
      await app.app.close();
    }

    rmSync(fileDir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('corrupt session JSON → loadLast returns null and renames backups to *-Corrupted.txt', async () => {
    const userDataDir = makeUserDataDir('np-session-corrupt');

    // Seed a valid snapshot first so backup files exist to be renamed.
    let app = await launchApp({ userDataDir });
    try {
      const w = await snapshot(app, {
        version: 1,
        tabs: [makeTab({ editorId: 'ed-c', filePath: null, isModified: true })],
        activeEditorId: 'ed-c',
        _backups: { 'ed-c': { lastSaved: 'base', pending: 'dirty edit' } },
      });
      expect(w.ok && w.written).toBe(true);
    } finally {
      await app.app.close();
    }

    // Corrupt the session JSON on disk (truncated/garbage) before restart.
    writeFileSync(join(userDataDir, 'NotepadsSessionData.json'), '{ this is not valid json', 'utf8');

    app = await launchApp({ userDataDir });
    try {
      const restored = await loadLast(app);
      expect(restored, 'corrupt JSON must yield a null (fresh) session').toBeNull();

      // Extension-less backups are renamed to *-Corrupted.txt (UWP parity).
      const backups = readdirSync(join(userDataDir, 'BackupFiles'));
      expect(backups.some((n) => n.endsWith('-Corrupted.txt'))).toBe(true);
      expect(backups).not.toContain('ed-c-LastSaved');
      expect(backups).not.toContain('ed-c-Pending');
    } finally {
      await app.app.close();
    }

    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('clearRecovered removes the session JSON + extension-less backups', async () => {
    const userDataDir = makeUserDataDir('np-session-clear');

    const app = await launchApp({ userDataDir });
    try {
      const w = await snapshot(app, {
        version: 1,
        tabs: [makeTab({ editorId: 'ed-d', filePath: null, isModified: true })],
        activeEditorId: 'ed-d',
        _backups: { 'ed-d': { lastSaved: 'base', pending: 'dirty' } },
      });
      expect(w.ok && w.written).toBe(true);
      await clearRecovered(app);
    } finally {
      await app.app.close();
    }

    expect(existsSync(join(userDataDir, 'NotepadsSessionData.json'))).toBe(false);
    const backupDir = join(userDataDir, 'BackupFiles');
    const remaining = existsSync(backupDir) ? readdirSync(backupDir) : [];
    expect(remaining.filter((n) => !n.includes('.'))).toEqual([]); // no extension-less backups left

    rmSync(userDataDir, { recursive: true, force: true });
  });
});
