/**
 * HTML escaping — RENDERER, Lane B (Phase 6). PURE (no DOM/IPC).
 *
 * Escapes the five XML/HTML metacharacters so untrusted editor text can be safely
 * interpolated into an HTML string (the print host builds its DOM from a string).
 * Kept tiny + dependency-free; markdown rendering uses markdown-it's own escaper.
 */

/** Escape `&`, `<`, `>`, `"`, `'` for safe insertion into HTML text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
