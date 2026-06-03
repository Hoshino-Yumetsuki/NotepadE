/**
 * Web search the selection (Ctrl+E) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.WebSearch.cs observable behavior:
 *   - No selection → no-op.
 *   - Trim the selected text; cap at 2000 chars (URL-length safety, matches the
 *     UWP `Substring(0, 2000)` guard).
 *   - Hand the query to MAIN via `window.notepads.shell.webSearch`. MAIN owns the
 *     URL-vs-search-engine decision (Uri.TryCreate http/https → launch directly,
 *     else format the configured engine template) — the renderer NEVER builds the
 *     URL or touches the shell directly (PA-8).
 *
 * This is a CM6 command (not a transaction): it reads state and calls the IPC
 * bridge. It always returns true when a selection exists so the keybinding is
 * consumed.
 */

import type { Command } from '@codemirror/view';

const MAX_SEARCH_LEN = 2000;

/**
 * Renderer-only observer for the resolved web-search query. Default is undefined
 * (production: nothing observes). The editor test seam sets this under
 * NOTEPADS_E2E so the Gate-3 e2e can read the exact query the command produced
 * WITHOUT monkey-patching the contextBridge-frozen window.notepads.shell. It is
 * invoked with the final (trimmed + capped) query right before the real IPC
 * call; it NEVER replaces or alters that call. PA-8: pure renderer callback.
 */
let onWebSearchQuery: ((query: string) => void) | undefined;

/** Install / clear the web-search query observer (used by the editor test seam). */
export function setWebSearchObserver(observer: ((query: string) => void) | undefined): void {
  onWebSearchQuery = observer;
}

export const webSearchSelection: Command = (view): boolean => {
  const range = view.state.selection.main;
  if (range.empty) return false;

  const selected = view.state.sliceDoc(range.from, range.to).trim();
  if (selected.length === 0) return false;

  const query = selected.length <= MAX_SEARCH_LEN ? selected : selected.slice(0, MAX_SEARCH_LEN);

  // Renderer-only test observation (no-op in production); never alters the call.
  onWebSearchQuery?.(query);

  // Fire-and-forget; the bridge resolves a Result we don't need to await here.
  void window.notepads?.shell.webSearch(query);
  return true;
};
