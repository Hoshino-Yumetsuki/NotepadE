/**
 * File IO — MAIN only. Reads bytes, decodes via the encoding engine, returns
 * authoritative descriptors. On save, re-applies EOL and encodes back to bytes.
 *
 * The renderer NEVER touches fs/path — all of this lives here behind IPC (PA-8).
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type {
  OpenedFile,
  Result,
  SaveArgs,
  SaveAsArgs,
  SaveResult,
  EncodingId,
  EolId,
} from '../shared/ipc-contract.js';
import { decodeBytes, decodeBytesWith, encodeText } from './encoding.js';
import { detectEol, applyEol } from './eol.js';
import { addRecentDocument } from './shell.js';
import { addRecent } from './mru.js';

/** Cache of last-known encoding/EOL per path so save can reuse them. */
const fileMeta = new Map<string, { encodingId: EncodingId; eolId: EolId }>();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Node fs error codes that are typically TRANSIENT (file locked by AV / sync). */
const TRANSIENT_WRITE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN']);

function errCode(e: unknown): string | undefined {
  return e != null && typeof e === 'object' && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Write bytes with bounded retries on transient locking errors. OneDrive sync,
 * antivirus scanners, and search indexers briefly hold a write lock that surfaces
 * as EBUSY/EPERM/EACCES; a short retry almost always succeeds (UWP did the same via
 * ExecuteFileIOOperationWithRetries / CachedFileManager.DeferUpdates). A
 * non-transient error (e.g. ENOENT, EISDIR) throws immediately. After the final
 * attempt the last error propagates so the caller surfaces a real failure.
 *
 * `writeFn` is injectable for unit tests; production uses fs/promises writeFile.
 */
export async function writeFileWithRetry(
  path: string,
  bytes: Buffer,
  attempts = 3,
  backoffMs = 80,
  writeFn: (p: string, b: Buffer) => Promise<void> = writeFile,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await writeFn(path, bytes);
      return;
    } catch (e) {
      lastErr = e;
      const code = errCode(e);
      if (code == null || !TRANSIENT_WRITE_CODES.has(code)) throw e; // not transient.
      if (i < attempts - 1) await sleep(backoffMs * (i + 1)); // linear backoff.
    }
  }
  throw lastErr;
}

export async function openFile(path: string): Promise<Result<OpenedFile>> {
  try {
    const bytes = await readFile(path);
    const { decodedText, encodingId, hasBom } = decodeBytes(bytes);
    const eolId = detectEol(decodedText);
    const stats = await stat(path);
    fileMeta.set(path, { encodingId, eolId });
    // Surface the opened file in the OS Jump List / Recents (UWP JumpListService).
    addRecentDocument(path);
    // Mirror it into the in-app MRU list (UWP MRUService). Fire-and-forget: the
    // recent list is a nicety and must never delay/break the open.
    void addRecent(path);
    return {
      ok: true,
      data: {
        decodedText,
        encodingId,
        eolId,
        dateModifiedMs: stats.mtimeMs,
        filePath: path,
        hasBom,
      },
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function reloadFromDisk(path: string): Promise<Result<OpenedFile>> {
  return openFile(path);
}

/**
 * Prompt for files to open via the native open dialog (multi-select; filters:
 * any file type). Returns the chosen ABSOLUTE paths, or `[]` on cancel —
 * cancellation is a normal success (the renderer treats `[]` as a no-op), unlike
 * saveAs where a cancel is surfaced as an error. The renderer opens each returned
 * path via `file.open`. PA-8: the dialog lives in MAIN; the renderer never sees it.
 */
export async function openFileDialog(): Promise<Result<string[]>> {
  try {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options: Electron.OpenDialogOptions = {
      title: 'Open',
      properties: ['openFile', 'multiSelections'],
    };
    const picked = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);

    if (picked.canceled) return { ok: true, data: [] };
    return { ok: true, data: picked.filePaths };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Re-read the file at `path` and decode it under an EXPLICIT encoding label
 * (status-bar "reopen with encoding"). Bypasses auto-detection. EOL is
 * re-detected from the freshly decoded text, and the per-path meta cache is
 * updated so the next save reuses the chosen encoding.
 */
export async function decodeWithEncoding(
  path: string,
  encodingId: EncodingId,
): Promise<Result<OpenedFile>> {
  try {
    const bytes = await readFile(path);
    const { decodedText, encodingId: resolvedId, hasBom } = decodeBytesWith(bytes, encodingId);
    const eolId = detectEol(decodedText);
    const stats = await stat(path);
    fileMeta.set(path, { encodingId: resolvedId, eolId });
    return {
      ok: true,
      data: {
        decodedText,
        encodingId: resolvedId,
        eolId,
        dateModifiedMs: stats.mtimeMs,
        filePath: path,
        hasBom,
      },
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function saveFile(args: SaveArgs): Promise<Result<SaveResult>> {
  try {
    return { ok: true, data: await writeShadowToPath(args.filePath, args) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Prompt for a destination via the native Save dialog, then write the shadow
 * text there. Cancellation surfaces as a normal error (renderer treats it as a
 * no-op). UWP parity: SaveFileAs prompts, then runs the same encode/write path.
 */
export async function saveFileAs(args: SaveAsArgs): Promise<Result<SaveResult>> {
  try {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const options: Electron.SaveDialogOptions = {
      title: 'Save As',
      defaultPath: dialogDefaultPath(args),
    };
    const picked = focused
      ? await dialog.showSaveDialog(focused, options)
      : await dialog.showSaveDialog(options);

    if (picked.canceled || !picked.filePath) {
      return { ok: false, error: 'Save canceled' };
    }

    return { ok: true, data: await writeShadowToPath(picked.filePath, args) };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Compose the Save dialog's defaultPath from suggestedName + defaultDir. */
function dialogDefaultPath(args: SaveAsArgs): string | undefined {
  if (args.suggestedName && args.defaultDir) {
    return join(args.defaultDir, args.suggestedName);
  }
  return args.defaultDir ?? args.suggestedName ?? undefined;
}

/**
 * Shared encode-and-write core for save / saveAs. Re-applies EOL to the
 * '\n'-normalized shadow text and encodes with the resolved label, reusing the
 * Phase-3 engine. The renderer NEVER re-derives encoding/EOL.
 */
async function writeShadowToPath(
  filePath: string,
  args: { shadowText?: string; encodingId?: EncodingId; eolId?: EolId },
): Promise<SaveResult> {
  const known = fileMeta.get(filePath);
  const encodingId = args.encodingId ?? known?.encodingId ?? 'UTF-8';
  const eolId = args.eolId ?? known?.eolId ?? 'crlf';

  // shadowText is '\n'-normalized from the renderer. If absent, re-read disk
  // content as the baseline (no-op save guard).
  let lfText: string;
  if (args.shadowText != null) {
    lfText = args.shadowText;
  } else {
    const existing = await readFile(filePath);
    lfText = decodeBytes(existing).decodedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  const withEol = applyEol(lfText, eolId);
  const bytes = encodeText(withEol, encodingId);
  await writeFileWithRetry(filePath, bytes);

  const stats = await stat(filePath);
  fileMeta.set(filePath, { encodingId, eolId });
  // Mirror the saved file into the in-app MRU list (UWP MRUService fed save too).
  // Fire-and-forget: persistence of the recent list must never break the save.
  void addRecent(filePath);
  return { filePath, dateModifiedMs: stats.mtimeMs, encodingId, eolId };
}

export async function revalidatePath(
  path: string,
): Promise<Result<{ exists: boolean; dateModifiedMs: number }>> {
  try {
    const stats = await stat(path);
    return { ok: true, data: { exists: true, dateModifiedMs: stats.mtimeMs } };
  } catch {
    return { ok: true, data: { exists: false, dateModifiedMs: 0 } };
  }
}
