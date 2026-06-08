/**
 * In-app Most-Recently-Used (MRU) recent-files list — MAIN only.
 *
 * 1:1 port of the UWP `MRUService` (E:\Projects\Notepads\src\Notepads\Services\
 * MRUService.cs), which wrapped `StorageApplicationPermissions.MostRecentlyUsedList`.
 * That API has no Electron equivalent, so we persist our own JSON list,
 * `RecentFiles.json`, in the app's userData root (same pattern as settings.ts /
 * session.ts). This is the IN-APP recent list and is DISTINCT from the OS jump
 * list (`app.addRecentDocument`, fed in shell.ts) — UWP fed both, so do we.
 *
 * Behavior (mirrors UWP semantics):
 *   - `addRecent(path)` inserts most-recent-first, de-duplicating by path
 *     (case-insensitive on win32, ordinal-uppercase) and capping at `MRU_CAP`
 *     (UWP top=10). All store mutations are serialized through a single promise
 *     chain so concurrent opens/saves across windows can't lose updates.
 *   - `listRecent()` reads the list and PRUNES entries whose file no longer exists
 *     (fs.stat fails), mirroring UWP `GetItemAsync` silently skipping renamed/
 *     deleted files. Surviving entries are stamped with a fresh `mtimeMs`.
 *   - `clearRecent()` empties the list (UWP `MRUService.ClearAll`).
 *
 * The renderer NEVER touches fs/path — all of this lives behind IPC (PA-8). The
 * e2e userData override (`NOTEPADS_E2E_USERDATA`) is honored exactly as in
 * settings.ts / session.ts so a scripted restart reads the same RecentFiles.json.
 */

import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { app } from 'electron';
import type { Result, RecentEntry } from '../shared/ipc-contract.js';

/** Single persisted recent-files file (UWP used the OS MRU access list). */
const MRU_FILE_NAME = 'RecentFiles.json';

/** Max entries retained, matching UWP `GetMostRecentlyUsedListAsync(top = 10)`. */
const MRU_CAP = 10;

/** On-disk shape: a plain array of absolute paths, most-recent-first. */
type StoredPaths = string[];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Resolve the userData root. Honors the e2e override (`NOTEPADS_E2E_USERDATA`,
 * also applied via `app.setPath` in index.ts) so a scripted restart — and the
 * unit test — hits the SAME RecentFiles.json. Falls back to Electron's userData.
 */
function userDataRoot(): string {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) return override;
  return app.getPath('userData');
}

function mruFilePath(): string {
  return join(userDataRoot(), MRU_FILE_NAME);
}

/** Case-insensitive on win32 (NTFS), case-sensitive elsewhere. Uses an ordinal
 * uppercase rather than toLowerCase() to avoid locale-dependent case folding
 * (e.g. the Turkish dotless-I), matching how win32 compares paths. */
function samePath(a: string, b: string): boolean {
  if (process.platform !== 'win32') return a === b;
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * Serialization tail for store mutations. ALL BrowserWindows share ONE main
 * process, and `addRecent` fires on every open AND every save, so two
 * near-simultaneous calls would otherwise both read the same base list and the
 * later rename would clobber the earlier (lost update). Chaining each
 * read-modify-write onto a single in-process promise makes them run atomically
 * w.r.t. one another. The tail itself never rejects (each link's outcome is
 * swallowed onto the tail copy) so one failure can't poison later writes; the
 * returned promise still surfaces the real result/error to its own caller.
 */
let writeTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = writeTail.then(op, op);
  writeTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Read the raw stored path list. A missing file (first run) or corrupt/foreign
 * JSON both resolve to an empty list — the recent list is a nicety and must never
 * throw. Non-string array members are dropped defensively.
 */
async function readStored(): Promise<StoredPaths> {
  try {
    const raw = await readFile(mruFilePath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

/**
 * Atomic write: serialize to a sibling tmp file then rename over the target, so a
 * crash mid-write can never leave a truncated RecentFiles.json (mirrors
 * settings.ts). The tmp name carries a timestamp + random suffix because
 * `process.pid` alone is SHARED across all windows in one main process — two
 * concurrent writers must not target the same tmp (torn-tmp-then-rename), even
 * though `enqueue` already serializes them (defense in depth). Best-effort tmp
 * cleanup on a failed rename.
 */
async function writeStored(paths: StoredPaths): Promise<void> {
  const targetPath = mruFilePath();
  const suffix = `${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpPath = `${targetPath}.${suffix}.tmp`;
  await writeFile(tmpPath, JSON.stringify(paths, null, 2), 'utf8');
  try {
    await rename(tmpPath, targetPath);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Insert `path` at the front of the recent list, de-duplicating by path and
 * capping at `MRU_CAP`. Called from the file-open / save / saveAs success paths
 * (alongside the OS jump-list `addRecentDocument`). Best-effort: a failure to
 * persist the recent list must never break the open/save itself, so errors are
 * swallowed (UWP `TryAdd` likewise swallowed and returned false).
 */
export async function addRecent(path: string): Promise<void> {
  try {
    if (!path || path.length === 0) return;
    await enqueue(async () => {
      const stored = await readStored();
      const deduped = stored.filter((p) => !samePath(p, path));
      deduped.unshift(path);
      await writeStored(deduped.slice(0, MRU_CAP));
    });
  } catch {
    // Recent list is a nicety; never let it surface (UWP TryAdd swallow).
  }
}

/**
 * List the recent files, most-recent-first, PRUNING entries whose file no longer
 * exists (fs.stat fails — renamed/deleted), mirroring UWP `GetItemAsync` skip.
 * Surviving entries carry a fresh `mtimeMs` + a basename `displayName`. When the
 * on-disk list changed due to pruning, the trimmed list is written back so stale
 * paths don't accumulate. Never throws: a read failure yields an empty list.
 */
export async function listRecent(): Promise<RecentEntry[]> {
  // Enqueued so the read + prune + write-back can't interleave with a concurrent
  // addRecent/clearRecent (which would make the write-back clobber a fresh entry).
  return enqueue(async () => {
    const stored = await readStored();
    const entries: RecentEntry[] = [];
    const survivors: StoredPaths = [];

    for (const path of stored) {
      if (entries.length >= MRU_CAP) break;
      try {
        const stats = await stat(path);
        entries.push({ path, displayName: basename(path), mtimeMs: stats.mtimeMs });
        survivors.push(path);
      } catch {
        // File renamed/deleted — drop it (UWP silent GetItemAsync skip).
      }
    }

    if (survivors.length !== stored.length) {
      await writeStored(survivors).catch(() => {});
    }
    return entries;
  }).catch(() => []); // listRecent never throws: a failure yields an empty list.
}

/** Clear the entire in-app recent list (UWP `MRUService.ClearAll`). */
export async function clearRecent(): Promise<Result<void>> {
  try {
    await enqueue(() => writeStored([]));
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Result-wrapped list for the IPC handler (listRecent itself never throws). */
export async function listRecentResult(): Promise<Result<RecentEntry[]>> {
  return { ok: true, data: await listRecent() };
}
