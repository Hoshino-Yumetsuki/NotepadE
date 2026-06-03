/**
 * File IO — MAIN only. Reads bytes, decodes via the encoding engine, returns
 * authoritative descriptors. On save, re-applies EOL and encodes back to bytes.
 *
 * The renderer NEVER touches fs/path — all of this lives here behind IPC (PA-8).
 */

import { readFile, writeFile, stat } from 'node:fs/promises';
import type {
  OpenedFile,
  Result,
  SaveArgs,
  SaveResult,
  EncodingId,
  EolId,
} from '../shared/ipc-contract.js';
import { decodeBytes, decodeBytesWith, encodeText } from './encoding.js';
import { detectEol, applyEol } from './eol.js';

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
    const { filePath } = args;
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
    return {
      ok: true,
      data: { filePath, dateModifiedMs: stats.mtimeMs, encodingId, eolId },
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
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
