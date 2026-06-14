/**
 * Web-search query observer (RENDERER, Lane B) — CM-free.
 *
 * A renderer-only seam: the editor test hook installs an observer under
 * NOTEPADS_E2E so the Gate-3 e2e can read the exact query the Ctrl+E command
 * produced (trimmed + capped) WITHOUT monkey-patching the contextBridge-frozen
 * window.notepads.shell. The Monaco web-search command invokes `emitWebSearchQuery`
 * with the final query right before the real IPC call; it NEVER replaces or alters
 * that call. Default: no observer (production observes nothing).
 *
 * Extracted from the deleted CM6 commands/webSearch.ts during the Monaco migration
 * (T6) so the Monaco command path + test hook import it without any @codemirror.
 * PA-8: pure renderer callback.
 */

let onWebSearchQuery: ((query: string) => void) | undefined;

/** Install / clear the web-search query observer (used by the editor test seam). */
export function setWebSearchObserver(observer: ((query: string) => void) | undefined): void {
  onWebSearchQuery = observer;
}

/** Fire the observer (no-op in production); never alters the real IPC call. */
export function emitWebSearchQuery(query: string): void {
  onWebSearchQuery?.(query);
}
