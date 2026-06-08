/**
 * Cross-window tab transfer — MAIN only (Phase 6, Workstream 6.A).
 *
 * MAIN is the SOLE router for moving a tab between windows (1:1 port of UWP
 * NotepadsCore.OnSetDropped 715-804 + SetDraggedOutside void-drop 819-830). The
 * renderer drag carries ONLY an opaque token over HTML5 DnD; the editor content
 * (lastSavedText/pendingText + labels) travels through this registry as a JSON
 * envelope, never over the drag itself.
 *
 * Flow:
 *   1. Source renderer calls `dragOut.begin(envelope)`. MAIN stamps the
 *      envelope's `sourceWindowId` AUTHORITATIVELY from the IPC event.sender
 *      (the renderer never supplies its own window id — PA-8) and stores it in a
 *      token-keyed registry, returning the token.
 *   2. Target renderer, on drop, calls `dragOut.complete(token, dropIndex)`.
 *      MAIN re-validates the envelope's filePath via fs.stat (PA-4 substitute),
 *      builds an authoritative OpenedFile descriptor, pushes `editor.adopt` to
 *      the TARGET window (event.sender) and `editor.release` to the SOURCE
 *      window. The undo stack is NOT carried — the target seeds a fresh history
 *      from lastSavedText + pendingText.
 *
 * Void-drop (renderer-detected drag that lands outside any window) reuses the
 * UWP rule and is handled in the renderer via the spawn path; the registry entry
 * is reclaimed by `abandon(token)` so a dropped-into-the-void token does not
 * leak. A token also expires after a timeout so a crashed drag self-heals.
 */

import { BrowserWindow } from 'electron';
import { stat } from 'node:fs/promises';
import type { Result, DragEnvelope, AdoptPayload, OpenedFile } from '../shared/ipc-contract.js';
import { IpcChannels } from '../shared/ipc-channels.js';

/** A pending transfer keyed by token: the envelope + the authoritative source. */
interface PendingTransfer {
  envelope: DragEnvelope;
  sourceWindowId: number;
  createdAt: number;
}

/** Token -> pending transfer. A drag is in this map between begin and complete. */
const registry = new Map<string, PendingTransfer>();

/** A stale transfer (no complete within this window) is garbage-collected. */
const TOKEN_TTL_MS = 60_000;

let tokenSeq = 0;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Mint a process-unique, unguessable-enough transfer token. */
function nextToken(): string {
  tokenSeq += 1;
  return `xfer-${Date.now().toString(36)}-${tokenSeq}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Drop transfers older than the TTL (a crashed/abandoned drag self-heals). */
function sweepExpired(): void {
  const now = Date.now();
  for (const [token, t] of registry) {
    if (now - t.createdAt > TOKEN_TTL_MS) registry.delete(token);
  }
}

/**
 * Begin a transfer. The `sourceWindowId` on the incoming envelope is IGNORED and
 * re-stamped from the IPC sender so a renderer can never spoof another window's
 * identity. Returns the token the source renderer attaches to the HTML5 drag.
 */
export function dragOutBegin(
  event: Electron.IpcMainInvokeEvent,
  envelope: DragEnvelope
): Result<{ token: string }> {
  try {
    sweepExpired();
    const sourceWin = BrowserWindow.fromWebContents(event.sender);
    if (!sourceWin) return { ok: false, error: 'No source window for this renderer' };
    const sourceWindowId = sourceWin.id;
    const token = nextToken();
    registry.set(token, {
      envelope: { ...envelope, sourceWindowId },
      sourceWindowId,
      createdAt: Date.now()
    });
    return { ok: true, data: { token } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Build the authoritative OpenedFile the target adopts. The file path is
 * re-validated via fs.stat (PA-4 substitute): a present file yields its real
 * mtime; a missing/renamed file keeps the path but reports mtime 0 (the target
 * shows it as the last-known content, consistent with the dragged text). An
 * untitled buffer (filePath null) is adopted verbatim.
 */
async function buildAdoptedFile(envelope: DragEnvelope): Promise<OpenedFile> {
  let dateModifiedMs = envelope.dateModifiedMs;
  if (envelope.filePath) {
    try {
      const stats = await stat(envelope.filePath);
      dateModifiedMs = stats.mtimeMs;
    } catch {
      // Missing at drop time — keep the path, fall back to the dragged mtime.
      dateModifiedMs = 0;
    }
  }
  return {
    decodedText: envelope.lastSavedText,
    encodingId: envelope.encodingId,
    eolId: envelope.eolId,
    dateModifiedMs,
    filePath: envelope.filePath,
    hasBom: false
  };
}

/**
 * Complete a transfer at `dropIndex` in the TARGET window (the caller). MAIN
 * builds the adopt payload, pushes `editor.adopt` to the target and
 * `editor.release` to the source, then clears the token. The undo stack is NOT
 * carried; the target rebuilds history from lastSavedText + pendingText.
 */
export async function dragOutComplete(
  event: Electron.IpcMainInvokeEvent,
  token: string,
  dropIndex: number
): Promise<Result<void>> {
  try {
    const pending = registry.get(token);
    if (!pending) return { ok: false, error: 'Unknown or expired transfer token' };
    registry.delete(token);

    const targetWin = BrowserWindow.fromWebContents(event.sender);
    if (!targetWin) return { ok: false, error: 'No target window for this renderer' };

    const { envelope, sourceWindowId } = pending;
    const file = await buildAdoptedFile(envelope);
    const adopt: AdoptPayload = {
      editorId: envelope.editorId,
      file,
      pendingText: envelope.isModified ? envelope.pendingText : null,
      isModified: envelope.isModified,
      dropIndex,
      viewMode: envelope.viewMode
    };

    // Push adopt to the target FIRST so the tab exists before the source drops it.
    targetWin.webContents.send(IpcChannels.EvtEditorAdopt, adopt);

    const sourceWin = BrowserWindow.fromId(sourceWindowId);
    if (sourceWin && !sourceWin.isDestroyed()) {
      sourceWin.webContents.send(IpcChannels.EvtEditorRelease, { editorId: envelope.editorId });
    }

    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Abandon a transfer whose drag ended without a valid drop (e.g. void-drop on a
 * titled/dirty tab, which is a no-op per UWP). Idempotent. Exposed for the
 * renderer's drag-cancel path and the test seam.
 */
export function dragOutAbandon(token: string): Result<void> {
  registry.delete(token);
  return { ok: true, data: undefined };
}

/** Test-only: current pending-token count (PA-8-clean; no fs/IPC). */
export function pendingTransferCount(): number {
  return registry.size;
}
