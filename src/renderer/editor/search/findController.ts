/**
 * Monaco integration layer for the pure find/replace engine (RENDERER, Lane B).
 *
 * Drop-in replacement for the CM6 findController. The pure engine in
 * ./searchEngine.ts is unchanged — it still operates on the '\n' shadow-buffer
 * string. This module is the thin glue that:
 *   - reads the current document + cursor out of an IStandaloneCodeEditor,
 *   - calls the engine (findNext / findPrevious / replaceAll / replace-one),
 *   - applies the resulting selection + reveals it via the Monaco API,
 *   - and maintains non-intrusive match-highlight decorations via
 *     deltaDecorations (class 'notepade-search-match', styled to match the
 *     former CM6 'cm-search-match' yellow wash).
 *
 * Public API surface is identical to the CM6 version so useFindBar + T6 wiring
 * need only update the editor-instance type, not the function signatures.
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
  type SearchOptions,
  type MatchSpan,
  findNext,
  findPrevious,
  findAllRegexMatches,
  replaceAll as engineReplaceAll
} from './searchEngine';

// Re-export SearchOptions so callers that imported it from here still work.
export type { SearchOptions };

/** A find query bundled with its options (the controller's working state). */
export interface FindQuery extends SearchOptions {
  query: string;
}

/** Outcome of a find operation, surfaced to the UI for status/labels. */
export interface FindOutcome {
  /** The match that was selected, or null when nothing matched. */
  match: MatchSpan | null;
  /** True when the search wrapped around the document boundary. */
  wrapped: boolean;
}

// ---------------------------------------------------------------------------
//  Highlight decorations
// ---------------------------------------------------------------------------

/** CSS class name applied to all match decoration spans. */
const MATCH_CLASS = 'notepade-search-match';

/**
 * Inject the match-highlight stylesheet once. Monaco's defineTheme `colors` map
 * cannot style arbitrary decoration classes; a plain <style> tag is the correct
 * approach (same technique the Monaco playground uses for custom decorations).
 */
let _styleInjected = false;
function ensureHighlightStyle(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .${MATCH_CLASS} {
      background-color: rgba(255, 213, 0, 0.32);
      border-radius: 2px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Per-editor decoration collection IDs. Monaco's deltaDecorations returns the
 * new IDs after each call; we keep the latest set so we can clear/replace it.
 */
const decorationMap = new WeakMap<monaco.editor.IStandaloneCodeEditor, string[]>();

/** Convert a 0-based MatchSpan offset pair to a Monaco IRange (1-based lines). */
function spanToRange(model: monaco.editor.ITextModel, span: MatchSpan): monaco.IRange {
  const start = model.getPositionAt(span.from);
  const end = model.getPositionAt(span.to);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  };
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function getDocText(editor: monaco.editor.IStandaloneCodeEditor): string {
  return editor.getModel()?.getValue(1 /* LF */) ?? '';
}

function getSelectionOffsets(editor: monaco.editor.IStandaloneCodeEditor): {
  from: number;
  to: number;
} {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return { from: 0, to: 0 };
  const from = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
  const to = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
  return { from, to };
}

function selectAndReveal(editor: monaco.editor.IStandaloneCodeEditor, span: MatchSpan): void {
  const model = editor.getModel();
  if (!model) return;
  const range = spanToRange(model, span);
  editor.setSelection(range);
  editor.revealRangeInCenter(range, 1 /* Immediate */);
}

// ---------------------------------------------------------------------------
//  Collect all matches (for highlight refresh)
// ---------------------------------------------------------------------------

function collectAllMatches(text: string, q: FindQuery): MatchSpan[] {
  if (q.query.length === 0) return [];
  if (q.useRegex) return findAllRegexMatches(text, q.query, q);

  const out: MatchSpan[] = [];
  let from = 0;
  for (;;) {
    const hit = findNext(text, q.query, q, from, false);
    if (!hit) break;
    out.push(hit);
    from = hit.to > hit.from ? hit.to : hit.from + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Public API — highlight management
// ---------------------------------------------------------------------------

/**
 * Recompute and apply ALL match highlights for the current query.
 * Empty queries clear the highlights.
 */
export function refreshHighlights(editor: monaco.editor.IStandaloneCodeEditor, q: FindQuery): void {
  ensureHighlightStyle();
  const model = editor.getModel();
  if (!model) return;
  const spans = collectAllMatches(getDocText(editor), q);
  const decorations: monaco.editor.IModelDeltaDecoration[] = spans.map((s) => ({
    range: spanToRange(model, s),
    options: { inlineClassName: MATCH_CLASS }
  }));
  const prev = decorationMap.get(editor) ?? [];
  const next = editor.deltaDecorations(prev, decorations);
  decorationMap.set(editor, next);
}

/** Clear all match highlights (e.g. when the find bar closes). */
export function clearHighlights(editor: monaco.editor.IStandaloneCodeEditor): void {
  const prev = decorationMap.get(editor) ?? [];
  const next = editor.deltaDecorations(prev, []);
  decorationMap.set(editor, next);
}

// ---------------------------------------------------------------------------
//  Public API — find / select
// ---------------------------------------------------------------------------

/**
 * Find-next from the current selection END, wrapping around the document.
 * Mirrors UWP TryFindNextAndSelect (stopAtEof=false).
 */
export function findNextInEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  q: FindQuery
): FindOutcome {
  if (q.query.length === 0) return { match: null, wrapped: false };
  const text = getDocText(editor);
  const { to } = getSelectionOffsets(editor);

  const direct = findNext(text, q.query, q, to, false);
  if (direct) {
    selectAndReveal(editor, direct);
    return { match: direct, wrapped: false };
  }
  const wrapped = findNext(text, q.query, q, 0, false);
  if (wrapped) {
    selectAndReveal(editor, wrapped);
    return { match: wrapped, wrapped: true };
  }
  return { match: null, wrapped: false };
}

/**
 * Find-previous from the current selection START, wrapping to the document end.
 * Mirrors UWP TryFindPreviousAndSelect (stopAtBof=false).
 */
export function findPreviousInEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  q: FindQuery
): FindOutcome {
  if (q.query.length === 0) return { match: null, wrapped: false };
  const text = getDocText(editor);
  const { from } = getSelectionOffsets(editor);

  const direct = findPrevious(text, q.query, q, from, false);
  if (direct) {
    selectAndReveal(editor, direct);
    return { match: direct, wrapped: false };
  }
  const wrapped = findPrevious(text, q.query, q, text.length, false);
  if (wrapped) {
    selectAndReveal(editor, wrapped);
    return { match: wrapped, wrapped: true };
  }
  return { match: null, wrapped: false };
}

// ---------------------------------------------------------------------------
//  Public API — replace
// ---------------------------------------------------------------------------

function selectionIsMatch(editor: monaco.editor.IStandaloneCodeEditor, q: FindQuery): boolean {
  const { from, to } = getSelectionOffsets(editor);
  if (to <= from) return false;
  const text = getDocText(editor);
  const hit = findNext(text, q.query, q, from, false);
  return hit !== null && hit.from === from && hit.to === to;
}

function expandRegexReplacement(
  editor: monaco.editor.IStandaloneCodeEditor,
  q: FindQuery,
  from: number,
  to: number,
  replacement: string
): string {
  const model = editor.getModel();
  if (!model) return replacement;
  const slice = model.getValue(1 /* LF */).slice(from, to);
  const result = engineReplaceAll(slice, q.query, q, replacement);
  return result.count > 0 ? result.text : slice;
}

/**
 * Replace the current match and advance to the next.
 * Mirrors UWP TryFindNextAndReplace. Returns true if a replacement happened.
 */
export function replaceOne(
  editor: monaco.editor.IStandaloneCodeEditor,
  q: FindQuery,
  replacement: string
): boolean {
  if (q.query.length === 0) return false;

  if (!selectionIsMatch(editor, q)) {
    const found = findNextInEditor(editor, q);
    if (!found.match) return false;
  }

  const model = editor.getModel();
  if (!model) return false;
  const { from, to } = getSelectionOffsets(editor);
  const insert = q.useRegex
    ? expandRegexReplacement(editor, q, from, to, replacement)
    : replacement;

  const startPos = model.getPositionAt(from);
  const endPos = model.getPositionAt(to);
  model.applyEdits([
    {
      range: {
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endPos.lineNumber,
        endColumn: endPos.column
      },
      text: insert
    }
  ]);

  // Advance to the next match.
  findNextInEditor(editor, q);
  return true;
}

/**
 * Replace EVERY occurrence as one push-edit = one undo step.
 * Mirrors UWP TryFindAndReplaceAll. Returns the replacement count.
 */
export function replaceAllInEditor(
  editor: monaco.editor.IStandaloneCodeEditor,
  q: FindQuery,
  replacement: string
): number {
  if (q.query.length === 0) return 0;
  const model = editor.getModel();
  if (!model) return 0;
  const text = getDocText(editor);
  const result = engineReplaceAll(text, q.query, q, replacement);
  if (result.count === 0) return 0;

  // Apply as a single full-document edit so it is one undo step.
  model.applyEdits([{ range: model.getFullModelRange(), text: result.text }]);

  // Move caret to document end (UWP StartPosition = int.MaxValue).
  const endPos = model.getPositionAt(result.text.length);
  editor.setPosition(endPos);
  editor.revealPosition(endPos);
  return result.count;
}

// ---------------------------------------------------------------------------
//  Public API — go to line
// ---------------------------------------------------------------------------

/**
 * Move the caret to 1-based `lineNumber`, clamped to the document's line range,
 * and reveal it (Ctrl+G). Returns the clamped line actually used.
 */
export function goToLine(editor: monaco.editor.IStandaloneCodeEditor, lineNumber: number): number {
  const model = editor.getModel();
  if (!model) return lineNumber;
  const lineCount = model.getLineCount();
  const clamped = Math.max(1, Math.min(lineNumber, lineCount));
  const pos = { lineNumber: clamped, column: 1 };
  editor.setPosition(pos);
  editor.revealLineInCenter(clamped, 1 /* Immediate */);
  return clamped;
}

// ---------------------------------------------------------------------------
//  Legacy CM6 compat shim
//  useFindBar / T6 may still reference the old EditorView-typed names during
//  the migration. These thin aliases let that code compile while T6 finalises.
// ---------------------------------------------------------------------------

/** @deprecated Use findNextInEditor */
export const findNextInView = findNextInEditor;
/** @deprecated Use findPreviousInEditor */
export const findPreviousInView = findPreviousInEditor;
/** @deprecated Use replaceAllInEditor */
export const replaceAllInView = replaceAllInEditor;

/**
 * @deprecated No-op shim. Monaco has no CM6 Extension bundle.
 * useFindBar no longer passes this to editors; kept so old imports compile.
 */
export function searchExtension(): [] {
  return [];
}
