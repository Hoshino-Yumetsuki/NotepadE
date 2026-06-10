/**
 * Custom wallpaper lifecycle — MAIN only (PA-8: fs/net/dialogs live here).
 *
 * The user picks a background image (local file via the native dialog, an
 * explicit local path, or an http(s) URL). MAIN copies/downloads the image into
 * the MANAGED folder `{userData}/wallpaper/` and persists ONLY the managed file
 * name in the settings store (`settings.wallpaperFileName`) — the user's
 * original path / the remote URL are never referenced again, so the wallpaper
 * keeps working if the source moves or goes offline (mirrors how UWP apps copy
 * picked assets into ApplicationData.Current.LocalFolder).
 *
 * Lifecycle rules:
 *   - REPLACE: the new image is written FIRST, the setting flips to the new
 *     name, then the previous managed file is deleted — a crash mid-replace can
 *     orphan at most one file, never break the active wallpaper.
 *   - CLEAR: the setting is emptied, then the managed file is deleted. No
 *     orphan accumulation: there is at most ONE managed wallpaper file.
 *   - Persistence + cross-window propagation ride the EXISTING settings path:
 *     setSettings() broadcasts EvtSettingsChanged to every window, and each
 *     renderer re-fetches the image via `wallpaper.get()` when the file name in
 *     its settings bag changes (no new push channel needed).
 *
 * Security (URL download):
 *   - http(s) only; the response content-type MUST be an allowed raster image
 *     type (SVG is deliberately excluded — it can embed script; raster formats
 *     are inert), and the byte stream is capped at MAX_WALLPAPER_BYTES while
 *     reading (a missing/lying Content-Length cannot blow past the cap).
 *   - Remote content is only ever STORED and later served to the renderer as a
 *     `data:` image URL (the page CSP already allows `img-src data:`) — it is
 *     never executed, never loaded as a document.
 *
 * Pure helpers (name/extension/mime validation) are exported for vitest; the
 * electron-touching functions (dialog/net/settings) stay e2e-territory, same
 * split as window-bounds.ts / mru.ts.
 */

import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { app, dialog, net, BrowserWindow } from 'electron';
import type { Result, WallpaperState } from '../shared/ipc-contract.js';
import { getSettings, setSettings } from './settings.js';

/** Managed subfolder under userData holding the (single) active wallpaper. */
const WALLPAPER_DIR_NAME = 'wallpaper';

/** Hard size cap for any wallpaper source (local stat / download stream). */
export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Allowed raster image extensions ↔ MIME types. SVG is EXCLUDED on purpose
 * (scriptable format; see module header). This single table drives extension
 * validation (local picks), content-type validation (downloads), and the
 * data-URL mime when serving the file back to the renderer.
 */
const IMAGE_TYPES: readonly { ext: string; mime: string }[] = [
  { ext: 'png', mime: 'image/png' },
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'jpeg', mime: 'image/jpeg' },
  { ext: 'webp', mime: 'image/webp' },
  { ext: 'gif', mime: 'image/gif' },
  { ext: 'bmp', mime: 'image/bmp' },
  { ext: 'avif', mime: 'image/avif' }
];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Resolve the userData root. Honors the e2e override (`NOTEPADS_E2E_USERDATA`)
 * BEFORE touching electron's `app`, exactly like settings.ts / mru.ts — this is
 * also what lets the fs-lifecycle unit tests run electron-free.
 */
function userDataRoot(): string {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) return override;
  return app.getPath('userData');
}

/** Absolute path of the managed wallpaper folder. */
function wallpaperDir(): string {
  return join(userDataRoot(), WALLPAPER_DIR_NAME);
}

// ---------------------------------------------------------------------------
//  Pure helpers (exported for vitest)
// ---------------------------------------------------------------------------

/** Lower-cased extension (no dot) of a path/name, '' when absent. */
export function imageExtensionOf(pathOrName: string): string {
  return extname(pathOrName).replace(/^\./, '').toLowerCase();
}

/** True when `ext` (no dot, any case) is an allowed raster image extension. */
export function isAllowedImageExtension(ext: string): boolean {
  const lower = ext.toLowerCase();
  return IMAGE_TYPES.some((t) => t.ext === lower);
}

/**
 * Map a response Content-Type (possibly with `; charset=` suffix) to the
 * canonical managed extension, or null when it is not an allowed image type.
 * This is the download-path gate: a URL serving text/html (or anything
 * non-image) is REJECTED regardless of its file extension.
 */
export function extensionForContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const found = IMAGE_TYPES.find((t) => t.mime === mime);
  return found ? found.ext : null;
}

/** MIME type for a managed extension (the data-URL header when serving). */
export function mimeForExtension(ext: string): string | null {
  const found = IMAGE_TYPES.find((t) => t.ext === ext.toLowerCase());
  return found ? found.mime : null;
}

/**
 * Compose a fresh managed file name. The timestamp keeps successive wallpapers
 * distinct (replace never overwrites in place, and a changed name doubles as a
 * cache-buster for the renderer), `nowMs` is injectable for deterministic tests.
 */
export function buildWallpaperFileName(ext: string, nowMs: number = Date.now()): string {
  return `wallpaper-${nowMs}.${ext.toLowerCase()}`;
}

/**
 * Validate a PERSISTED wallpaper file name before resolving it under the
 * managed folder. Settings.json is user-editable on disk, so the name must
 * match exactly what buildWallpaperFileName produces — this forbids path
 * separators / `..` traversal and any extension outside the allowed set.
 */
export function isSafeWallpaperFileName(name: string): boolean {
  const m = /^wallpaper-\d+\.([a-z0-9]+)$/.exec(name);
  return m !== null && isAllowedImageExtension(m[1]);
}

// ---------------------------------------------------------------------------
//  Managed-folder fs primitives (electron-free; unit-tested with a temp dir)
// ---------------------------------------------------------------------------

/**
 * Write `bytes` as a new managed wallpaper file inside `dir` (created on
 * demand). Returns the absolute path written. Name must already be validated.
 */
export async function writeManagedWallpaper(
  dir: string,
  fileName: string,
  bytes: Buffer
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const target = join(dir, fileName);
  await writeFile(target, bytes);
  return target;
}

/**
 * Delete a previously managed wallpaper file, best-effort. Refuses unsafe
 * names (defense in depth — only names this module generated are removable)
 * and never throws: replace/clear must not fail because the old file is
 * already gone or briefly locked.
 */
export async function deleteManagedWallpaper(dir: string, fileName: string): Promise<void> {
  if (!fileName || !isSafeWallpaperFileName(fileName)) return;
  await rm(join(dir, fileName), { force: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
//  IPC-facing API (electron-touching)
// ---------------------------------------------------------------------------

/**
 * Mutation serializer — guards the "at most ONE managed file" invariant.
 *
 * Without it, two interleaved activations (a URL set racing a Browse pick:
 * each window's IPC handler awaits independently) can BOTH read the same
 * `previous` name; the loser's freshly written file then ends up neither
 * active nor deleted — a permanent orphan. Chaining every read-modify-delete
 * section through one module-level promise makes the previous-name read and
 * the old-file delete atomic with respect to other mutations. Only the FAST
 * critical section (settings write + unlink) is serialized — slow downloads/
 * copies happen before entering the queue, so a slow URL fetch never blocks a
 * concurrent local pick. Exported for the vitest ordering test.
 */
let wallpaperMutationChain: Promise<unknown> = Promise.resolve();
export function enqueueWallpaperMutation<T>(op: () => Promise<T>): Promise<T> {
  // Run after whatever is queued, whether it settled ok or not (a failed
  // mutation must never wedge the chain — second arg runs on rejection too).
  const run = wallpaperMutationChain.then(op, op);
  // Swallow for the CHAIN only; callers still observe `run`'s real outcome.
  wallpaperMutationChain = run.catch(() => {});
  return run;
}

/** Read the current persisted wallpaper file name ('' when none). */
async function currentFileName(): Promise<string> {
  const r = await getSettings();
  return r.ok ? r.data.wallpaperFileName : '';
}

/**
 * Activate `fileName`: persist it (broadcasts EvtSettingsChanged to every
 * window via the settings path), then delete the previous managed file. Write
 * order (new file already on disk → setting → delete old) means a crash can
 * orphan at most one stale file, never dangle the active setting. The whole
 * read→persist→delete section runs inside the mutation queue so concurrent
 * activations can never both read the same `previous` (orphan race).
 */
function activate(fileName: string): Promise<Result<WallpaperState>> {
  return enqueueWallpaperMutation(async () => {
    const previous = await currentFileName();
    const persisted = await setSettings({ wallpaperFileName: fileName });
    if (!persisted.ok) return persisted;
    if (previous && previous !== fileName) {
      await deleteManagedWallpaper(wallpaperDir(), previous);
    }
    return getWallpaper();
  });
}

/**
 * Current wallpaper as a data URL. A missing/manually-deleted file resolves to
 * the empty state (reads never fail the app — same policy as settings reads).
 */
export async function getWallpaper(): Promise<Result<WallpaperState>> {
  try {
    const fileName = await currentFileName();
    if (!fileName || !isSafeWallpaperFileName(fileName)) {
      return { ok: true, data: { fileName: '', dataUrl: null } };
    }
    const mime = mimeForExtension(imageExtensionOf(fileName));
    if (!mime) return { ok: true, data: { fileName: '', dataUrl: null } };
    const bytes = await readFile(join(wallpaperDir(), fileName));
    return {
      ok: true,
      data: { fileName, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
    };
  } catch {
    // File vanished underneath the setting (manual cleanup) — treat as unset.
    return { ok: true, data: { fileName: '', dataUrl: null } };
  }
}

/**
 * Copy a local image into the managed folder and activate it. Validates the
 * extension against the allowed raster set and enforces the size cap BEFORE
 * copying. The user's original file is left untouched and never referenced.
 */
export async function setWallpaperFromPath(path: string): Promise<Result<WallpaperState>> {
  try {
    const ext = imageExtensionOf(path);
    if (!isAllowedImageExtension(ext)) {
      return { ok: false, error: `Unsupported image type: .${ext || '(none)'}` };
    }
    const info = await stat(path);
    if (!info.isFile()) return { ok: false, error: 'Not a file' };
    if (info.size > MAX_WALLPAPER_BYTES) {
      return { ok: false, error: `Image exceeds the ${MAX_WALLPAPER_BYTES / (1024 * 1024)}MB limit` };
    }
    const fileName = buildWallpaperFileName(ext);
    const dir = wallpaperDir();
    await mkdir(dir, { recursive: true });
    await copyFile(path, join(dir, fileName));
    return activate(fileName);
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Download an http(s) image into the managed folder and activate it. Uses
 * Electron's `net.fetch` (Chromium network stack — proxy/cert aware). The
 * content-type gate and the streaming byte cap both run BEFORE anything is
 * written to disk; remote bytes are stored as an inert image file only.
 */
export async function setWallpaperFromUrl(url: string): Promise<Result<WallpaperState>> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'Invalid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Only http(s) URLs are supported' };
    }

    const res = await net.fetch(parsed.toString(), { redirect: 'follow' });
    if (!res.ok) return { ok: false, error: `Download failed (HTTP ${res.status})` };

    const ext = extensionForContentType(res.headers.get('content-type'));
    if (!ext) {
      return { ok: false, error: 'URL did not return a supported image type' };
    }
    const declaredLength = Number(res.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_WALLPAPER_BYTES) {
      return { ok: false, error: `Image exceeds the ${MAX_WALLPAPER_BYTES / (1024 * 1024)}MB limit` };
    }

    // Stream with a hard cap: a missing/lying Content-Length cannot overrun.
    if (!res.body) return { ok: false, error: 'Empty response body' };
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WALLPAPER_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: `Image exceeds the ${MAX_WALLPAPER_BYTES / (1024 * 1024)}MB limit` };
      }
      chunks.push(Buffer.from(value));
    }
    if (total === 0) return { ok: false, error: 'Empty response body' };

    const fileName = buildWallpaperFileName(ext);
    await writeManagedWallpaper(wallpaperDir(), fileName, Buffer.concat(chunks));
    return activate(fileName);
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Prompt for a local image via MAIN's native open dialog, then run the same
 * copy/activate path. Cancel resolves `null` as a normal success (file.openDialog
 * convention). PA-8: the dialog never reaches the renderer.
 */
export async function pickWallpaper(): Promise<Result<WallpaperState | null>> {
  try {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options: Electron.OpenDialogOptions = {
      title: 'Choose background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_TYPES.map((t) => t.ext) }]
    };
    const picked = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return { ok: true, data: null };
    return setWallpaperFromPath(picked.filePaths[0]);
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Remove the active wallpaper: empty the setting, then delete the file. Runs
 * inside the mutation queue (same read→persist→delete shape as activate, and
 * the same orphan race if a clear interleaves a set).
 */
export function clearWallpaper(): Promise<Result<void>> {
  return enqueueWallpaperMutation(async () => {
    try {
      const previous = await currentFileName();
      const persisted = await setSettings({ wallpaperFileName: '' });
      if (!persisted.ok) return persisted;
      if (previous) await deleteManagedWallpaper(wallpaperDir(), previous);
      return { ok: true, data: undefined };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  });
}
