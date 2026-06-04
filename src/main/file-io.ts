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

/** Cache of last-known encoding/EOL per path so save can reuse them. */
const fileMeta = new Map<string, { encodingId: EncodingId; eolId: EolId }>();

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
  await writeFile(filePath, bytes);

  const stats = await stat(filePath);
  fileMeta.set(filePath, { encodingId, eolId });
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
