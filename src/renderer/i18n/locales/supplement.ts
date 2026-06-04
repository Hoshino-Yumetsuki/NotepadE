/**
 * supplement.ts — renderer-owned i18n overlay for web-port-only strings.
 *
 * These keys have NO UWP .resw origin: the original UWP app either hardcodes them
 * in C# code-behind (e.g. LineEndingUtility.GetLineEndingDisplayText) or they are
 * web/Electron-only chrome with no UWP equivalent (tab scroll buttons, the find
 * match counter). The generated locale tables (locales/*.ts) are a PURE projection
 * of the UWP .resw and are guarded by `port-resw --check`; we therefore do NOT add
 * these keys there. Instead resolve.ts merges this overlay UNDER the generated
 * table (generated always wins) so a key here only resolves when the generated
 * tables don't define it. A disjoint-keys guard (resolve.test.ts) asserts
 * SUPPLEMENT keys ∩ generated keys = ∅, keeping the 29-locale matrix + --check the
 * single source of truth for ported strings.
 *
 * Translation status: AWAITING-TRANSLATION. Every entry currently carries only an
 * 'en-US' value; the runtime fallback is overlay[locale] → overlay['en-US'] → the
 * generated chain, so all 29 locales render the English string until a translation
 * is contributed. To localize, just add the locale tag to the entry, e.g.
 *   'StatusBar_LineEnding_Crlf': { 'en-US': 'Windows (CRLF)', 'de-DE': 'Windows (CRLF)' }
 * No code change is required — the merge in resolve.ts reads whatever tags exist.
 *
 * PA-8: pure data, no imports of fs/path/child_process and no IPC. Imported
 * statically by resolve.ts so the bundler tree-shakes it like any other module.
 */

import type { SupportedLocale } from './index';

/** A per-locale value map for one supplement key; 'en-US' is always present. */
export type SupplementEntry = { 'en-US': string } & Partial<Record<SupportedLocale, string>>;

/**
 * Web-port supplement keys. Key names follow the UWP convention so wave-2
 * string-wrapping references them like any ported key:
 *   - StatusBar_LineEnding_*  — EOL indicator labels (UWP LineEndingUtility, C#).
 *   - TabStrip_*Button.AutomationProperties.Name — web tab-strip aria affordances
 *     (UWP used a single inline "+" and had no scroll buttons).
 *   - FindAndReplace_MatchCountText — the find "N of M" match counter ("{0} of {1}").
 */
export const SUPPLEMENT: Record<string, SupplementEntry> = {
  // EOL display labels (gap #1) — awaiting-translation.
  StatusBar_LineEnding_Crlf: { 'en-US': 'Windows (CRLF)' },
  StatusBar_LineEnding_Cr: { 'en-US': 'Macintosh (CR)' },
  StatusBar_LineEnding_Lf: { 'en-US': 'Unix (LF)' },
  // Tab-strip web aria-labels (gap #3) — awaiting-translation.
  'TabStrip_NewTabButton.AutomationProperties.Name': { 'en-US': 'New tab' },
  'TabStrip_CloseTabButton.AutomationProperties.Name': { 'en-US': 'Close tab' },
  'TabStrip_ScrollLeftButton.AutomationProperties.Name': { 'en-US': 'Scroll tabs left' },
  'TabStrip_ScrollRightButton.AutomationProperties.Name': { 'en-US': 'Scroll tabs right' },
  // Find match counter (gap #3) — awaiting-translation. {0}=current, {1}=total.
  FindAndReplace_MatchCountText: { 'en-US': '{0} of {1}' },
  // Find/replace a11y aria-labels — awaiting-translation. The web port adds an
  // accessible name on the find/replace container and the replace input (UWP
  // exposed these via AutomationProperties; distinct from the existing
  // FindAndReplace_ReplaceBar.PlaceholderText="Replace" generated key).
  'FindAndReplace_FindAndReplaceControl.AutomationProperties.Name': { 'en-US': 'Find and replace' },
  'FindAndReplace_ReplaceBar.AutomationProperties.Name': { 'en-US': 'Replace with' },
  // Status-bar a11y aria-labels — awaiting-translation. The UWP status bar exposed
  // these affordances via AutomationProperties on its native controls; the web port
  // re-declares them as overlay keys (no .resw origin) for screen-reader parity.
  StatusBar_FilePath: { 'en-US': 'File path' },
  StatusBar_Zoom: { 'en-US': 'Zoom' },
  StatusBar_ZoomLevel: { 'en-US': 'Zoom level' },
  StatusBar_Encoding: { 'en-US': 'Encoding' },
  StatusBar_LineEnding: { 'en-US': 'Line ending' },
  StatusBar_LineColumnGoTo: { 'en-US': 'Line and column, go to line' },
  // Shadow-window (secondary instance) hint title — awaiting-translation.
  StatusBar_ShadowWindowHint: { 'en-US': 'This is a shadow window' },
};
