/**
 * Session snapshot + crash recovery — MAIN only.
 *
 * 1:1 port of UWP `SessionManager` / `SessionUtility` (E:\Projects\Notepads):
 *   - A versioned `NotepadsSessionData.json` (Version==1) is written to the app's
 *     userData root, dirty-checked against the last serialized JSON so we only
 *     touch disk when the session actually changed (UWP `_lastSessionJsonStr`).
 *   - Per-tab content is mirrored into extension-less backup files under
 *     `{userData}/BackupFiles/`: `{editorId}-LastSaved` (the on-disk snapshot)
 *     and `{editorId}-Pending` (unsaved edits, only when the tab is dirty).
 *   - A corrupt session JSON is treated like UWP's `SessionDataCorruptedException`:
 *     extension-less backup files are renamed to `{name}-Corrupted.txt` and
 *     `loadLast` returns null (no crash, fresh start).
 *   - PA-4 FutureAccessList substitute: stored ABSOLUTE PATHS are re-validated on
 *     load via `revalidatePath` (fs.stat). A missing/renamed file marks the tab
 *     `unavailable:true` with its `filePath` PRESERVED (mirrors UWP's
 *     `GetItemAsync` try/catch silent-skip), distinct from an untitled buffer.
 *
 * The renderer NEVER touches fs/path — all of this lives behind IPC (PA-8). The
 * internal `_backups` sidecar (underscore-prefixed) is stripped before any
 * snapshot crosses IPC back to the renderer.
 */

import { mkdir, readFile, writeFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { Result, SessionSnapshot, SessionTab } from '../shared/ipc-contract.js';
import { revalidatePath } from './file-io.js';

/** UWP `SessionUtility.SessionMetaDataFileDefaultName`. */
const SESSION_FILE_NAME = 'NotepadsSessionData.json';
/** UWP `SessionUtility.BackupFolderDefaultName`. */
const BACKUP_FOLDER_NAME = 'BackupFiles';

/** Per-tab backup payload kept ONLY in MAIN; never serialized into the JSON. */
interface TabBackup {
  /** The last on-disk content for the tab (UWP `{id}-LastSaved`). */
  lastSaved?: string;
  /** Unsaved edits, present only when the tab is dirty (UWP `{id}-Pending`). */
  pending?: string;
}

/**
 * Internal session shape: the contract snapshot plus an underscore sidecar that
 * carries per-editor backup text. The sidecar is the substitute for UWP's
 * separate backup-file references and is ALWAYS stripped before IPC.
 */
interface InternalSnapshot extends SessionSnapshot {
  /** editorId -> backup text. Underscore-prefixed: stripped before IPC. */
  _backups?: Record<string, TabBackup>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Resolve the userData root. Honors the e2e override (`NOTEPADS_E2E_USERDATA`,
 * also applied via `app.setPath` in index.ts) so a scripted kill→restart hits
 * the SAME session JSON + backups. Falls back to Electron's userData path.
 */
function userDataRoot(): string {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) return override;
  return app.getPath('userData');
}

function sessionFilePath(): string {
  return join(userDataRoot(), SESSION_FILE_NAME);
}

function backupFolderPath(): string {
  return join(userDataRoot(), BACKUP_FOLDER_NAME);
}

function lastSavedBackupName(editorId: string): string {
  return `${editorId}-LastSaved`;
}

function pendingBackupName(editorId: string): string {
  return `${editorId}-Pending`;
}

/**
 * Last serialized session JSON, mirroring UWP `_lastSessionJsonStr`. Used to
 * dirty-check snapshots so the 7s timer only writes when state actually changed.
 */
let lastSessionJsonStr: string | null = null;

/**
 * Serialize a snapshot to the on-disk JSON string. The `_backups` sidecar is
 * excluded — the JSON only ever holds the contract surface (Version==1, tabs,
 * activeEditorId), matching UWP's `NotepadsSessionDataV1`.
 */
function serializeForDisk(data: SessionSnapshot): string {
  const ordered = {
    version: 1 as const,
    tabs: data.tabs,
    activeEditorId: data.activeEditorId
  };
  return JSON.stringify(ordered, null, 2);
}

/**
 * Persist a session snapshot. Dirty-checked against the last written JSON
 * (case-insensitive, UWP `StringComparison.OrdinalIgnoreCase`); when unchanged
 * we return `{ written: false }` without touching disk. On a real write we (1)
 * write the versioned JSON to userData root, (2) write per-tab LastSaved/Pending
 * backups, (3) delete orphaned backups for editors no longer in the session.
 */
export async function snapshot(data: InternalSnapshot): Promise<Result<{ written: boolean }>> {
  try {
    const sessionJsonStr = serializeForDisk(data);
    if (
      lastSessionJsonStr !== null &&
      lastSessionJsonStr.toLowerCase() === sessionJsonStr.toLowerCase()
    ) {
      return { ok: true, data: { written: false } };
    }

    await mkdir(backupFolderPath(), { recursive: true });
    await writeFile(sessionFilePath(), sessionJsonStr, 'utf8');
    await writeBackups(data);
    await deleteOrphanedBackups(data.tabs);

    lastSessionJsonStr = sessionJsonStr;
    return { ok: true, data: { written: true } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Write per-tab backup files from the `_backups` sidecar. LastSaved is written
 * whenever provided; Pending is written only when the tab is dirty and pending
 * text exists, mirroring UWP's `LastSavedSnapshot.Content != GetText()` guard.
 */
async function writeBackups(data: InternalSnapshot): Promise<void> {
  const backups = data._backups;
  if (!backups) return;
  const folder = backupFolderPath();
  const byId = new Map(data.tabs.map((t) => [t.editorId, t]));

  for (const [editorId, backup] of Object.entries(backups)) {
    if (backup.lastSaved != null) {
      await writeFile(join(folder, lastSavedBackupName(editorId)), backup.lastSaved, 'utf8');
    }
    const tab = byId.get(editorId);
    const pendingPath = join(folder, pendingBackupName(editorId));
    if (tab?.isModified && backup.pending != null) {
      await writeFile(pendingPath, backup.pending, 'utf8');
    } else {
      // Tab is clean (or has no pending edits): drop any stale pending backup so
      // recovery never re-surfaces resolved edits. rm(force) is a no-op if absent.
      await rm(pendingPath, { force: true });
    }
  }
}

/**
 * Delete extension-less backup files whose editorId is no longer present in the
 * live session (UWP `DeleteOrphanedBackupFilesAsync`). Files WITH an extension
 * (e.g. `*-Corrupted.txt`) are skipped — they are user-facing recovery dumps.
 */
async function deleteOrphanedBackups(tabs: SessionTab[]): Promise<void> {
  const folder = backupFolderPath();
  const liveNames = new Set<string>();
  for (const t of tabs) {
    liveNames.add(lastSavedBackupName(t.editorId));
    liveNames.add(pendingBackupName(t.editorId));
  }

  let entries: string[];
  try {
    entries = await readdir(folder);
  } catch {
    return; // folder absent -> nothing to prune
  }

  for (const name of entries) {
    if (name.includes('.')) continue; // skip files with extension
    if (liveNames.has(name)) continue; // skip known-live backups
    await rm(join(folder, name), { force: true });
  }
}

/**
 * Load the last persisted session.
 *
 * Three recovery cases (UWP `LoadLastSessionAsync` + `RecoverBackupFilesAsync`):
 *   (a) no session file               -> return null (fresh start).
 *   (b) session file, no pending text -> restore tabs from LastSaved content.
 *   (c) session file with pending     -> restore tabs from Pending content.
 *
 * Corrupt JSON is treated as UWP's `SessionDataCorruptedException`: rename the
 * extension-less backups to `{name}-Corrupted.txt` and return null.
 *
 * PA-4: every tab.filePath is re-validated via `revalidatePath` (fs.stat). A
 * missing/renamed file sets `unavailable:true` with `filePath` PRESERVED.
 */
export async function loadLast(): Promise<Result<SessionSnapshot | null>> {
  let raw: string;
  try {
    raw = await readFile(sessionFilePath(), 'utf8');
  } catch {
    return { ok: true, data: null }; // case (a): no file
  }

  let parsed: SessionSnapshot;
  try {
    parsed = JSON.parse(raw) as SessionSnapshot;
    if (parsed?.version !== 1 || !Array.isArray(parsed.tabs)) {
      throw new Error('Unexpected session shape');
    }
  } catch {
    // Corrupt JSON -> rename backups, drop the bad session file, fresh start.
    await renameCorruptedBackups();
    return { ok: true, data: null };
  }

  try {
    const tabs: SessionTab[] = [];
    for (const tab of parsed.tabs) {
      tabs.push(await revalidateTab(tab));
    }
    lastSessionJsonStr = serializeForDisk(parsed);
    return { ok: true, data: { version: 1, tabs, activeEditorId: parsed.activeEditorId } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * PA-4 re-validation for a single tab. Untitled buffers (filePath:null) pass
 * through untouched. A backed file that fails fs.stat is marked unavailable with
 * its path PRESERVED so the UI can offer relocate/save-as. The content itself is
 * recovered from the backup files by the renderer; the path stays authoritative.
 */
async function revalidateTab(tab: SessionTab): Promise<SessionTab> {
  if (!tab.filePath) {
    const { unavailable: _unavailable, ...rest } = tab;
    return rest;
  }
  const res = await revalidatePath(tab.filePath);
  const exists = res.ok && res.data.exists;
  if (exists) {
    const { unavailable: _unavailable, ...rest } = tab;
    return rest;
  }
  return { ...tab, unavailable: true };
}

/**
 * Rename every extension-less file in the backup folder to `{name}-Corrupted.txt`
 * and remove the corrupt session JSON (UWP `RecoverBackupFilesAsync` rename +
 * fresh start). Idempotent: files that already carry an extension are skipped.
 */
async function renameCorruptedBackups(): Promise<void> {
  const folder = backupFolderPath();
  let entries: string[];
  try {
    entries = await readdir(folder);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (name.includes('.')) continue; // skip already-extensioned (e.g. *-Corrupted.txt)
    try {
      await rename(join(folder, name), join(folder, `${name}-Corrupted.txt`));
    } catch {
      // best-effort: a failed rename must not block fresh start
    }
  }
  await rm(sessionFilePath(), { force: true });
  lastSessionJsonStr = null;
}

/**
 * Clear recovered backup files after the user discards recovery (UWP clears the
 * session + backups). Removes the session JSON and every extension-less backup;
 * `{name}-Corrupted.txt` dumps are left for the user to inspect/delete.
 */
export async function clearRecovered(): Promise<Result<void>> {
  try {
    await rm(sessionFilePath(), { force: true });
    const folder = backupFolderPath();
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      if (name.includes('.')) continue; // preserve *-Corrupted.txt recovery dumps
      await rm(join(folder, name), { force: true });
    }
    lastSessionJsonStr = null;
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Read a tab's recovered content for the renderer. Prefers Pending (unsaved
 * edits, case (c)) over LastSaved (case (b)); returns null when neither backup
 * exists. Exposed so the loadLast IPC path / renderer can hydrate buffers.
 */
export async function readTabBackup(editorId: string): Promise<TabBackup | null> {
  const folder = backupFolderPath();
  const out: TabBackup = {};
  out.lastSaved = await readBackupFile(join(folder, lastSavedBackupName(editorId)));
  out.pending = await readBackupFile(join(folder, pendingBackupName(editorId)));
  if (out.lastSaved == null && out.pending == null) return null;
  return out;
}

async function readBackupFile(path: string): Promise<string | undefined> {
  try {
    await stat(path);
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Test seam: reset the in-memory dirty-check cache (UWP `_lastSessionJsonStr = null`). */
export function __resetSessionDirtyCache(): void {
  lastSessionJsonStr = null;
}
