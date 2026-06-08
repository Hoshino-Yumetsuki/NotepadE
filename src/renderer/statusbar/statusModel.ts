/**
 * Pure status-bar display helpers (RENDERER, Lane C). No React, no IPC, no fs —
 * just the string/format logic the UWP code-behind performs so it is unit-
 * testable in isolation.
 *
 *   - line/column + selected-word count (NotepadsMainPage.StatusBar.cs:149-162,
 *     RichEditBox GetLineColumnSelection semantics)
 *   - EOL display text (LineEndingUtility.GetLineEndingDisplayText)
 *   - the dynamic encoding-menu MODEL (BuildEncodingIndicatorFlyout structure):
 *     Unicode set + "More encodings" submenu from the ANSI table.
 */

import type { EolId, AnsiEncodingEntry, EncodingId } from '@shared/ipc-contract';

// ---------------------------------------------------------------------------
//  Line / column / selection
// ---------------------------------------------------------------------------

/** A '\n'-shadow-buffer caret/selection range (offsets), like CM6's main range. */
export interface CaretRange {
  from: number;
  to: number;
}

/** Derived 1-based line/column + selected-character count for the status bar. */
export interface LineColumn {
  /** 1-based line index of the selection START (UWP startLineIndex). */
  line: number;
  /** 1-based column of the selection START (UWP startColumn). */
  column: number;
  /** Number of selected characters (UWP selectedCount). 0 when collapsed. */
  selectedCount: number;
}

/**
 * Compute {line, column, selectedCount} from a '\n'-normalized document and the
 * main selection range. Mirrors UWP `GetLineColumnSelection`:
 *   - line/column reference the selection START,
 *   - column is 1-based (UWP reports column as charsToLeft + 1),
 *   - selectedCount is the count of selected characters in the shadow buffer.
 *
 * The shadow buffer is single-'\n' (one char per break), matching the UWP '\r'
 * working buffer's one-char-per-break offset arithmetic (docs/plan/04 §3.A).
 */
export function computeLineColumn(doc: string, range: CaretRange): LineColumn {
  const start = Math.max(0, Math.min(range.from, range.to));
  const end = Math.max(range.from, range.to);
  // Line = number of '\n' before `start`, +1 for 1-based.
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < start; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      lastBreak = i;
    }
  }
  const column = start - lastBreak; // chars since last break, 1-based.
  return { line, column, selectedCount: end - start };
}

/**
 * The status-bar line/column text. UWP shows a short form when nothing is
 * selected ("Ln {line}, Col {column}") and a full form with the selected count
 * otherwise ("Ln {line}, Col {column} ({count} {characters|character} selected)").
 * The resource strings are en-US defaults; i18n is Phase 6.
 */
export function formatLineColumn(lc: LineColumn): string {
  if (lc.selectedCount === 0) {
    return `Ln ${lc.line}, Col ${lc.column}`;
  }
  const noun = lc.selectedCount > 1 ? 'characters' : 'character';
  return `Ln ${lc.line}, Col ${lc.column} (${lc.selectedCount} ${noun} selected)`;
}

// ---------------------------------------------------------------------------
//  EOL display text
// ---------------------------------------------------------------------------

/** UWP LineEndingUtility.GetLineEndingDisplayText, keyed by our EolId. */
export function eolDisplayText(eol: EolId): string {
  switch (eol) {
    case 'crlf':
      return 'Windows (CRLF)';
    case 'cr':
      return 'Macintosh (CR)';
    case 'lf':
      return 'Unix (LF)';
  }
}

/** The three EOL menu rows (UWP NotepadsMainPage.xaml:608-610). */
export interface EolMenuRow {
  eol: EolId;
  text: string;
}

export const EOL_MENU_ROWS: readonly EolMenuRow[] = [
  { eol: 'crlf', text: 'Windows (CRLF)' },
  { eol: 'cr', text: 'Macintosh (CR)' },
  { eol: 'lf', text: 'Unix (LF)' }
];

// ---------------------------------------------------------------------------
//  Encoding menu model (dynamic) — BuildEncodingIndicatorFlyout structure
// ---------------------------------------------------------------------------

/**
 * The Unicode encodings UWP lists ABOVE the "More encodings" ANSI submenu, in
 * order (NotepadsMainPage.StatusBar.cs:516-522). Labels match MAIN's
 * EncodingUtility.GetEncodingName output (the opaque encodingId).
 */
export const UNICODE_ENCODINGS: readonly EncodingId[] = [
  'UTF-8',
  'UTF-8-BOM',
  'UTF-16 LE BOM',
  'UTF-16 BE BOM'
];

/** A leaf encoding row (reopen-with / save-with both use the same label). */
export interface EncodingMenuRow {
  /** The opaque encodingId to pass to decodeWith / save-with. */
  encodingId: EncodingId;
  /** Display label (== encodingId for our labels). */
  label: string;
}

/**
 * The fully-built encoding-menu MODEL (pure data; the component renders it):
 *   - `unicode`: the four Unicode rows shown inline.
 *   - `more`: the "More encodings" submenu rows from the ANSI table.
 * Both "Reopen with" and "Save with" parent menus reuse this same model — only
 * the action differs (decodeWith vs save-with-encoding), exactly like UWP's
 * AddEncodingItem adding the row to both submenus.
 */
export interface EncodingMenuModel {
  unicode: EncodingMenuRow[];
  more: EncodingMenuRow[];
}

/** Build the encoding-menu model from the ANSI table MAIN returns. */
export function buildEncodingMenuModel(ansi: readonly AnsiEncodingEntry[]): EncodingMenuModel {
  return {
    unicode: UNICODE_ENCODINGS.map((id) => ({ encodingId: id, label: id })),
    more: ansi.map((e) => ({ encodingId: e.label, label: e.label }))
  };
}
