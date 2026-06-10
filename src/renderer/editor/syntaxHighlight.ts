/**
 * Extension-matched syntax highlighting — RENDERER, Lane B.
 *
 * "需要支持基本的代码高亮": basic, language-aware code highlighting selected by
 * the file's extension, following the app's Fluent light/dark theme.
 *
 * - Language matching uses @codemirror/language-data's lazy registry: 140+
 *   LanguageDescriptions whose parsers load on demand via dynamic import (vite
 *   code-splits each into its own chunk), so the base bundle only carries the
 *   metadata table. `matchFilename` covers extensions AND filename patterns.
 * - Plain .txt and untitled (no path) documents stay UNHIGHLIGHTED — Notepad
 *   parity. Unknown extensions also fall through to plain text.
 * - Theme-aware colors: light uses CM6's defaultHighlightStyle; dark uses a
 *   VS-Code-dark-inspired HighlightStyle defined here (the upstream default is
 *   light-only); high-contrast gets NO color highlighting (forced-colors paints
 *   flat system colors — tinted tokens would fight the HC palette).
 * - PERF gate: documents longer than MAX_HIGHLIGHT_DOC_LENGTH never get a
 *   language mounted, protecting the large-file path (BigScaler docs) from
 *   parse cost. The gate is re-evaluated on authoritative loads (setDoc).
 *
 * PA-8: pure renderer; the dynamic imports are bundled chunks, not fs access.
 */

import {
  defaultHighlightStyle,
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * Documents longer than this never get a language parser (highlighting stays
 * off). 5M chars ≈ a 5MB ASCII file — far beyond "code file" territory and
 * into the large-file path the editor keeps deliberately lean.
 */
export const MAX_HIGHLIGHT_DOC_LENGTH = 5_000_000;

/**
 * The LanguageDescription for `filePath`'s basename, or null for plain text /
 * unknown / extensionless files. Matching is delegated to the registry's own
 * extension + filename-pattern tables (e.g. "x.json" → JSON, "Dockerfile" →
 * Dockerfile). `.txt` has no registered language, so Notepad's bread-and-butter
 * file type naturally stays plain.
 */
export function matchLanguage(filePath: string | null | undefined): LanguageDescription | null {
  if (!filePath) return null;
  const basename = filePath.split(/[\\/]/).pop() ?? '';
  if (!basename) return null;
  return LanguageDescription.matchFilename(languages, basename);
}

/**
 * Dark-theme token colors, VS Code "Dark+"-adjacent so they read naturally on
 * the app's dark acrylic surface. Deliberately minimal: the broad tag groups
 * cover every language-data grammar without per-language tuning ("basic"
 * highlighting per the request).
 */
const darkHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.moduleKeyword, tags.operatorKeyword], color: '#569cd6' },
  { tag: [tags.controlKeyword], color: '#c586c0' },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: '#ce9178' },
  { tag: [tags.number, tags.integer, tags.float], color: '#b5cea8' },
  { tag: [tags.bool, tags.null, tags.atom], color: '#569cd6' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#6a9955' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#dcdcaa' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#4ec9b0' },
  { tag: [tags.propertyName, tags.attributeName], color: '#9cdcfe' },
  { tag: [tags.variableName, tags.definition(tags.variableName)], color: '#9cdcfe' },
  { tag: [tags.tagName], color: '#569cd6' },
  { tag: [tags.angleBracket, tags.bracket, tags.punctuation], color: '#808080' },
  { tag: [tags.regexp, tags.escape], color: '#d16969' },
  { tag: [tags.meta, tags.processingInstruction], color: '#c586c0' },
  { tag: [tags.heading], color: '#569cd6', fontWeight: 'bold' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: 'bold' },
  { tag: [tags.link, tags.url], color: '#3794ff' },
  { tag: [tags.invalid], color: '#f44747' }
]);

/**
 * The theme-matched token-color extension. Light (and the fallback) uses CM6's
 * default light style; dark uses the palette above; HC returns NO style so
 * forced-colors' flat system palette is never fought by tinted tokens. The
 * language PARSER is still mounted under HC (the language compartment doesn't
 * gate on theme — see applyLanguageRef in CodeMirrorEditor): tokens are parsed
 * but render uncolored, which is the intended flat-HC presentation.
 */
export function highlightStyleFor(themeMode: 'light' | 'dark' | 'hc'): Extension {
  if (themeMode === 'hc') return [];
  return themeMode === 'dark'
    ? syntaxHighlighting(darkHighlightStyle)
    : syntaxHighlighting(defaultHighlightStyle, { fallback: true });
}

/**
 * Whether a document of `docLength` chars at `filePath` should be highlighted
 * at all (the perf gate + plain-text rules in one place).
 */
export function shouldHighlight(
  filePath: string | null | undefined,
  docLength: number
): boolean {
  return docLength <= MAX_HIGHLIGHT_DOC_LENGTH && matchLanguage(filePath) !== null;
}
