/**
 * Pure web-search query builder — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/webSearch.ts for Monaco reuse (T2 → T3).
 */

const MAX_SEARCH_LEN = 2000;

/**
 * Build the query string from a raw selection text:
 *   1. trim whitespace,
 *   2. cap at 2000 characters.
 * Returns `null` when the trimmed result is empty (no-op).
 */
export function buildWebSearchQuery(selected: string): string | null {
  const trimmed = selected.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= MAX_SEARCH_LEN ? trimmed : trimmed.slice(0, MAX_SEARCH_LEN);
}
