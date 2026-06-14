/**
 * Pure indent/outdent logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/indent.ts for Monaco reuse (T2 → T3).
 * Re-exports editorSettings pure helpers (indentString, normalizeTabAsSpaces).
 */

export type { TabAsSpaces } from '../../editorSettings';
export { indentString, normalizeTabAsSpaces } from '../../editorSettings';
import { indentString } from '../../editorSettings';
import type { TabAsSpaces } from '../../editorSettings';

/** Number of leading spaces in a line's text. */
export function leadingSpaces(text: string): number {
  let n = 0;
  while (n < text.length && text[n] === ' ') n++;
  return n;
}

/** How many leading chars to strip from one line for one outdent level. */
export function outdentWidthForLine(text: string, tabAsSpaces: TabAsSpaces): number {
  if (text.startsWith('\t')) return 1;
  const spaces = leadingSpaces(text);
  if (spaces === 0) return 0;
  const indentAmount = tabAsSpaces === -1 ? 4 : tabAsSpaces;
  const insufficient = spaces % indentAmount;
  return insufficient > 0 ? insufficient : Math.min(indentAmount, spaces);
}

// ---------------------------------------------------------------------------
//  Line-range helpers used by the Monaco command wiring (T3).
// ---------------------------------------------------------------------------

/**
 * Split `docText` into lines (LF-normalised). Returns an array of
 * `{ text, from, to }` where `from`/`to` are absolute offsets (to = exclusive,
 * NOT including the trailing '\n').
 */
export function splitLines(docText: string): Array<{ text: string; from: number; to: number }> {
  const lines: Array<{ text: string; from: number; to: number }> = [];
  let pos = 0;
  for (const raw of docText.split('\n')) {
    lines.push({ text: raw, from: pos, to: pos + raw.length });
    pos += raw.length + 1; // +1 for the '\n'
  }
  return lines;
}

export interface IndentRangeResult {
  /** Per-line changes: each entry is { from, to, insert } (no-deletion insert at line start). */
  changes: Array<{ from: number; to: number; insert: string }>;
  newAnchor: number;
  newHead: number;
}

/**
 * Compute multi-line indent for the line range that spans [selFrom, selTo].
 * Single-line (or collapsed) indents are handled by the caller with a simple
 * replaceSelection — this helper covers the multi-line block case only.
 */
export function indentRange(
  docText: string,
  selFrom: number,
  selTo: number,
  selAnchor: number,
  selHead: number,
  tabAsSpaces: TabAsSpaces
): IndentRangeResult {
  const tabStr = indentString(tabAsSpaces);
  const lines = splitLines(docText);
  const startLineIdx = lines.findIndex((l) => l.from <= selFrom && selFrom <= l.to);
  const endLineIdx = lines.findIndex((l) => l.from <= selTo && selTo <= l.to);

  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const width = tabStr.length;
  let inserted = 0;
  for (let i = startLineIdx; i <= endLineIdx; i++) {
    changes.push({ from: lines[i].from, to: lines[i].from, insert: tabStr });
    inserted += width;
  }
  const firstWidth = width;
  const newAnchor = selAnchor + firstWidth;
  const newHead = selHead + (selHead === selFrom ? firstWidth : inserted);
  return { changes, newAnchor, newHead };
}

export interface OutdentRangeResult {
  changes: Array<{ from: number; to: number; insert: string }>;
  newAnchor: number;
  newHead: number;
  anyChange: boolean;
}

/**
 * Compute multi-line outdent for the line range that spans [selFrom, selTo].
 */
export function outdentRange(
  docText: string,
  selFrom: number,
  selTo: number,
  selAnchor: number,
  selHead: number,
  tabAsSpaces: TabAsSpaces
): OutdentRangeResult {
  const lines = splitLines(docText);
  const startLineIdx = lines.findIndex((l) => l.from <= selFrom && selFrom <= l.to);
  const endLineIdx = lines.findIndex((l) => l.from <= selTo && selTo <= l.to);
  const startLine = lines[startLineIdx];

  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let removedBeforeAnchor = 0;
  let removedBeforeHead = 0;
  let anyChange = false;

  for (let i = startLineIdx; i <= endLineIdx; i++) {
    const line = lines[i];
    const w = outdentWidthForLine(line.text, tabAsSpaces);
    if (w === 0) continue;
    anyChange = true;
    changes.push({ from: line.from, to: line.from + w, insert: '' });
    if (line.from < selAnchor) removedBeforeAnchor += Math.min(w, selAnchor - line.from);
    if (line.from < selHead) removedBeforeHead += Math.min(w, selHead - line.from);
  }

  const newAnchor = Math.max(startLine.from, selAnchor - removedBeforeAnchor);
  const newHead = Math.max(startLine.from, selHead - removedBeforeHead);
  return { changes, newAnchor, newHead, anyChange };
}
