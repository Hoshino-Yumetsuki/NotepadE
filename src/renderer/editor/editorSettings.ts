/**
 * Editor-behavior settings and pure helpers shared by Monaco command wiring.
 * Encoding and EOL labels remain opaque backend-owned values.
 */

/**
 * Tab-as-spaces width. Mirrors UWP `TabIndents` / AddIndentation(indent):
 *   -1  → a real '\t' character (DEFAULT).
 *    2 | 4 | 8 → that many spaces per indent level.
 * The appendix pins the legal set {-1, 2, 4, 8}; any other value is treated as
 * a real tab to stay safe.
 */
export type TabAsSpaces = -1 | 2 | 4 | 8;

/** Web-search engine selection. Mirrors UWP SearchEngineUtility.SearchEngine. */
export type SearchEngineId = 'bing' | 'google' | 'duckDuckGo' | 'custom';

/** The editor-behavior settings the commands read. */
export interface EditorSettings {
  /** -1 (real tab, default) | 2 | 4 | 8 spaces per indent. */
  tabAsSpaces: TabAsSpaces;
  /** Smart Copy: trim whitespace from the selection on COPY only. Default off. */
  smartCopy: boolean;
  /** Active web-search engine for Ctrl+E (MAIN resolves the URL template). */
  searchEngine: SearchEngineId;
  /** Custom search URL template (e.g. https://example.com/search?q={0}). */
  customSearchUrl: string;
  /** Base editor font size in px; zoom is applied as a multiple of this. */
  fontSize: number;
}

/** UWP defaults: real tab, smart-copy off, Bing, '', 14px editor font. */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  tabAsSpaces: -1,
  smartCopy: false,
  searchEngine: 'bing',
  customSearchUrl: '',
  fontSize: 14
};

/** Normalize an arbitrary number to the legal {-1,2,4,8} set (else real tab). */
export function normalizeTabAsSpaces(value: number): TabAsSpaces {
  return value === 2 || value === 4 || value === 8 ? value : -1;
}

/**
 * The string a single indent inserts for the given tab-as-spaces setting.
 * Mirrors UWP AddIndentation: `indent == -1 ? "\t" : new string(' ', indent)`.
 */
export function indentString(tabAsSpaces: TabAsSpaces): string {
  return tabAsSpaces === -1 ? '\t' : ' '.repeat(tabAsSpaces);
}
