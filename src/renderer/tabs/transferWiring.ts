/**
 * ============================================================================
 *  Cross-window transfer wiring (RENDERER, Workstream 6.A) — App-level glue
 * ============================================================================
 *
 * The renderer half of the MAIN-routed tab transfer (UWP OnSetDropped /
 * SetDraggedOutside). It does NOT move content itself — MAIN is the sole router.
 * This module:
 *   - builds the DragEnvelope from a tab + its editor text and calls
 *     `dragOut.begin` to get a token (the HTML5 drag carries ONLY that token),
 *   - subscribes to `editor.adopt` (insert a tab at dropIndex, seed it from the
 *     adopted OpenedFile + pendingText — fresh undo history) and `editor.release`
 *     (remove the moved tab from the source window),
 *   - applies the void-drop rule (drag that ends outside any window): an
 *     untitled+unmodified tab spawns a blank window and is removed here; a
 *     titled or dirty tab is a no-op (UWP SetDraggedOutside).
 *
 * PA-8: every fs/window side effect goes through `window.notepads` — this file
 * never touches fs/path. The test seam below is likewise PA-8-clean: it composes
 * the SAME calls the drag UI makes, so Playwright (which cannot synthesize a
 * real HTML5 cross-process drag) drives the genuine transfer path via lane-h's
 * Gate-6 harness.
 */

import type { AdoptPayload, DragEnvelope } from '@shared/ipc-contract';
import type { TabsStore } from './useTabsStore';
import type { NotepadsTestHook } from '../editor/test-hook';

/** Per-editor text accessors the App provides (reads the live CM6 doc). */
export interface TransferTextSource {
  /** The last-saved ('\n'-normalized) baseline for an editor, or '' if unknown. */
  getLastSavedText(editorId: string): string;
  /** The current pending ('\n'-normalized) doc for an editor (dirty buffer). */
  getPendingText(editorId: string): string;
  /** Seed a freshly-adopted editor's document (fresh undo history). */
  seedAdoptedDoc(editorId: string, text: string): void;
}

/**
 * Build the cross-window envelope for a tab. `sourceWindowId` is a placeholder
 * (0) — MAIN re-stamps it authoritatively from the IPC sender, so the renderer
 * never needs (or has) its own window id.
 */
export function buildEnvelope(
  store: TabsStore,
  source: TransferTextSource,
  editorId: string
): DragEnvelope | null {
  const tab = store.get(editorId);
  if (!tab) return null;
  return {
    sourceWindowId: 0, // re-stamped in MAIN from event.sender
    editorId,
    filePath: tab.filePath,
    lastSavedText: source.getLastSavedText(editorId),
    pendingText: tab.isModified ? source.getPendingText(editorId) : null,
    encodingId: tab.encodingId,
    eolId: tab.eolId,
    isModified: tab.isModified,
    fileNamePlaceholder: tab.filePath === null ? tab.untitledName || 'Untitled' : '',
    dateModifiedMs: 0,
    viewMode: tab.viewMode
  };
}

/** Begin a transfer for `editorId`; resolves to the drag token or null on error. */
export async function beginTransfer(
  store: TabsStore,
  source: TransferTextSource,
  editorId: string
): Promise<string | null> {
  const envelope = buildEnvelope(store, source, editorId);
  if (!envelope) return null;
  const res = await window.notepads.dragOut.begin(envelope);
  return res.ok ? res.data.token : null;
}

/** Complete a transfer at `dropIndex` in THIS (target) window. */
export async function completeTransfer(token: string, dropIndex: number): Promise<boolean> {
  const res = await window.notepads.dragOut.complete(token, dropIndex);
  return res.ok;
}

/**
 * Apply an `editor.adopt` push: insert the moved tab at dropIndex and seed its
 * document. The target rebuilds undo history fresh from the adopted text — the
 * source's undo stack is intentionally NOT carried (UWP parity).
 *
 * MAIN only ever pushes adopt to the TARGET window (release goes to the source),
 * so an adopt is ALWAYS cross-window here. editorSeq is per-renderer, so the
 * source's `payload.editorId` (e.g. editor-1) can clash with an unrelated tab the
 * target already owns; reusing it would activate that blank tab and drop the
 * adopted doc (R3). We therefore ignore the source id for our local namespace and
 * mint a FRESH local editorId, seed under it, and return it so the caller can key
 * its diff baseline by the real local id.
 */
export function applyAdopt(
  store: TabsStore,
  source: TransferTextSource,
  payload: AdoptPayload
): string {
  const { file, pendingText, isModified, dropIndex, viewMode } = payload;
  const localId = store.mintEditorId();
  store.newTab({
    editorId: localId,
    filePath: file.filePath,
    encodingId: file.encodingId,
    eolId: file.eolId,
    isModified,
    untitledName: file.filePath === null ? '' : undefined,
    index: dropIndex,
    activate: true
  });
  store.setViewMode(localId, viewMode);
  // Seed the visible document: the dirty pending text if modified, else the
  // last-saved baseline. The editor seam wires the doc into the CM6 instance.
  source.seedAdoptedDoc(
    localId,
    isModified && pendingText != null ? pendingText : file.decodedText
  );
  return localId;
}

/** Apply an `editor.release` push: drop the moved tab from the SOURCE window. */
export function applyRelease(store: TabsStore, editorId: string): void {
  store.close(editorId);
}

/**
 * Void-drop rule (UWP SetDraggedOutside): only an untitled+unmodified tab, when
 * it is not the last tab, may be flung out — it spawns a fresh blank window and
 * is removed here. A titled or dirty tab is a no-op. Returns whether it acted.
 */
export function handleVoidDrop(store: TabsStore, editorId: string): boolean {
  const tab = store.get(editorId);
  if (!tab) return false;
  if (store.count() <= 1) return false;
  if (tab.isModified || tab.filePath !== null) return false; // titled/dirty -> no-op
  store.close(editorId);
  void window.notepads.window.brokerRequest({ paths: [], forceNewWindow: true });
  return true;
}

// ---------------------------------------------------------------------------
//  Test seam — window.__notepadsTest.transfer (PA-8-clean, lane-h Gate-6)
// ---------------------------------------------------------------------------

/** The transfer surface exposed to the Gate-6 harness. */
export interface TransferTestHook {
  /** Build + begin a transfer for `editorId`; returns the drag token (or null). */
  begin(editorId: string): Promise<string | null>;
  /** Complete a transfer at `dropIndex` in this window. */
  complete(token: string, dropIndex: number): Promise<boolean>;
  /** Apply the void-drop rule for `editorId`; returns whether it acted. */
  voidDrop(editorId: string): boolean;
  /** Serialize the envelope a drag would carry (assert sourceWindowId stamping). */
  envelope(editorId: string): DragEnvelope | null;
}

/**
 * Install `window.__notepadsTest.transfer`. Coexists with the editor/tabs hooks
 * (all write the same `window.__notepadsTest` object). Returns an uninstaller.
 */
export function installTransferTestHook(store: TabsStore, source: TransferTextSource): () => void {
  if (typeof window === 'undefined') return () => {};

  const transfer: TransferTestHook = {
    begin: (editorId) => beginTransfer(store, source, editorId),
    complete: (token, dropIndex) => completeTransfer(token, dropIndex),
    voidDrop: (editorId) => handleVoidDrop(store, editorId),
    envelope: (editorId) => buildEnvelope(store, source, editorId)
  };

  const existing = window.__notepadsTest as
    | (NotepadsTestHook & { transfer?: TransferTestHook })
    | undefined;
  if (existing) {
    existing.transfer = transfer;
  } else {
    window.__notepadsTest = { transfer } as unknown as NotepadsTestHook;
  }

  return () => {
    const hook = window.__notepadsTest as
      | (NotepadsTestHook & { transfer?: TransferTestHook })
      | undefined;
    if (hook) delete hook.transfer;
  };
}
