/**
 * Web-search URL resolution — MAIN, Lane B (Phase 6). PURE (no electron/fs/IPC).
 *
 * Extracted from `shell.ts` so the URL-vs-query decision is unit-testable in the
 * vitest/jsdom env WITHOUT importing `electron` (which cannot load there). `shell.ts`
 * re-exports these and performs the actual `shell.openExternal`.
 *
 * Pure port of the UWP web-search resolution path:
 *   - SearchEngineUtility.cs       (engine → URL template table)
 *   - TextEditorCore.WebSearch.cs  (URL-vs-query decision + token formatting)
 *
 * Parity rules (verbatim from the UWP source):
 *   1. If the query parses as an ABSOLUTE http/https URI, launch it DIRECTLY
 *      (UWP `Uri.TryCreate(..., Absolute)` + scheme == http/https guard).
 *   2. Otherwise format the configured engine template, substituting the query
 *      with its whitespace runs replaced by '+' (UWP
 *      `string.Join("+", searchString.Split(null))` — .NET Split(null) splits on
 *      ALL Unicode whitespace and drops empty entries).
 *   3. The engine table is the verbatim UWP `SearchEngineUrlDictionary`; 'custom'
 *      uses the user's `customSearchUrl` (UWP `EditorCustomMadeSearchUrl`).
 */

import type { SearchEngineId } from '../shared/ipc-contract.js';

/**
 * Verbatim UWP engine → URL template table (SearchEngineUtility.cs). `{0}` is the
 * query placeholder (occurs twice in the Google template, matching UWP). 'custom'
 * has no built-in template — it resolves to the user's customSearchUrl.
 */
const SEARCH_ENGINE_TEMPLATES: Record<Exclude<SearchEngineId, 'custom'>, string> = {
  bing: 'https://www.bing.com/search?q={0}&form=NPCTXT',
  google: 'https://www.google.com/search?q={0}&oq={0}',
  duckDuckGo: 'https://duckduckgo.com/?q={0}&ia=web',
};

/** True when `value` is an absolute http/https URL (UWP TryCreate + scheme guard). */
function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Replace every run of whitespace with a single '+', dropping empties — the JS
 * equivalent of .NET `string.Join("+", searchString.Split(null))`.
 */
function plusJoinWhitespace(query: string): string {
  return query
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .join('+');
}

/** Resolve the URL template for the configured engine (custom → user's URL). */
export function templateForEngine(engine: SearchEngineId, customSearchUrl: string): string {
  return engine === 'custom' ? customSearchUrl : SEARCH_ENGINE_TEMPLATES[engine];
}

/**
 * Resolve a raw query to a launchable absolute URL, or `null` when it cannot be
 * resolved (empty query, custom engine with no template, or a malformed result).
 * `null` means "do not launch" — a silent no-op mirroring the UWP try/catch.
 */
export function resolveSearchUrl(
  query: string,
  engine: SearchEngineId,
  customSearchUrl: string,
): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  // 1. A bare absolute http/https URL is launched directly (no engine formatting).
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;

  // 2. Otherwise format the engine template with the '+'-joined query.
  const template = templateForEngine(engine, customSearchUrl);
  if (!template || template.length === 0) return null; // custom engine, no URL set.

  const formatted = template.replace(/\{0\}/g, plusJoinWhitespace(trimmed));
  return isAbsoluteHttpUrl(formatted) ? formatted : null;
}
