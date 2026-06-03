/**
 * CM6 integration layer for the pure find/replace engine (RENDERER, Lane B).
 *
 * The pure engine in ./searchEngine.ts knows nothing about CodeMirror: it
 * operates on the '\n' shadow-buffer string and returns {from,to} spans. This
 * controller is the thin glue that:
 *   - reads the current document + caret/selection out of an EditorView,
 *   - calls the engine (findNext / findPrevious / replaceAll / replace-one),
 *   - dispatches the resulting selection + scrollIntoView as ONE transaction,
 *   - and maintains a non-intrusive match HIGHLIGHT decoration.
 *
 * It mirrors the UWP TextEditorCore.FindAndReplace.cs control flow:
 *   - find-next starts at the selection END; find-previous at the selection
 *     START (TryFindNextAndSelect / TryFindPreviousAndSelect).
 *   - replace-one replaces the CURRENT selection only if it already equals a
 *     match at the caret, then advances to the next match (TryFindNextAndReplace
 *     does select→SetText→find-next). We reproduce that as: ensure a match is
 *     selected (find first if not), replace it, then find-next.
 *   - replace-all is ONE transaction = ONE undo step (UWP SetText once); the
 *     caret is moved to the document end exactly like UWP (StartPosition =
 *     int.MaxValue).
 */

import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import {
  type SearchOptions,
  type MatchSpan,
  findNext,
  findPrevious,
  findAllRegexMatches,
  replaceAll as engineReplaceAll,
} from './searchEngine';

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

// --- Match highlight decoration ---------------------------------------------

/** Effect carrying the spans to highlight (cleared with an empty array). */
const setHighlightsEffect = StateEffect.define<readonly MatchSpan[]>();

const highlightMark = Decoration.mark({ class: 'cm-search-match' });

/**
 * StateField holding the current match highlights. Spans are mapped through
 * document changes so highlights stay anchored until the next search refresh.
 */
const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlightsEffect)) {
        const spans = effect.value;
        next = Decoration.set(
          spans
            .filter((s) => s.to > s.from)
            .map((s) => highlightMark.range(s.from, s.to)),
          true,
        );
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Theme for the match highlight. Subtle translucent fill (non-accent). */
const highlightTheme = EditorView.baseTheme({
  '.cm-search-match': {
    backgroundColor: 'rgba(255, 213, 0, 0.32)',
    borderRadius: '2px',
  },
});

/**
 * The extension bundle the editor must install to support find highlighting.
 * Selection/scroll uses CM6's built-in selection; only highlighting needs state.
 */
export function searchExtension(): Extension {
  return [highlightField, highlightTheme];
}

// --- Read helpers ------------------------------------------------------------

/** The current document as the '\n' shadow buffer (CM6 lineSeparator is '\n'). */
function docText(view: EditorView): string {
  return view.state.doc.toString();
}

/** The main selection's [from, to) offsets. */
function selectionRange(view: EditorView): { from: number; to: number } {
  const r = view.state.selection.main;
  return { from: r.from, to: r.to };
}

// --- Highlight refresh -------------------------------------------------------

/**
 * Recompute and apply ALL match highlights for the current query. For literal /
 * whole-word queries this walks findNext; for regex it reuses findAllRegexMatches.
 * Empty queries clear the highlights. Dispatched as a highlight-only effect so it
 * never creates an undo step.
 */
export function refreshHighlights(view: EditorView, q: FindQuery): void {
  const spans = collectAllMatches(docText(view), q);
  view.dispatch({ effects: setHighlightsEffect.of(spans) });
}

/** Clear all match highlights (e.g. when the find bar closes). */
export function clearHighlights(view: EditorView): void {
  view.dispatch({ effects: setHighlightsEffect.of([]) });
}

/** Collect every match in the document for the given query. */
function collectAllMatches(text: string, q: FindQuery): MatchSpan[] {
  if (q.query.length === 0) return [];
  if (q.useRegex) return findAllRegexMatches(text, q.query, q);

  const out: MatchSpan[] = [];
  let from = 0;
  // Walk forward without wrapping; stop when no further match is found.
  for (;;) {
    const hit = findNext(text, q.query, q, from, false);
    if (!hit) break;
    out.push(hit);
    // Advance past this match; guard zero-length (can't happen for literal).
    from = hit.to > hit.from ? hit.to : hit.from + 1;
  }
  return out;
}

// --- Find / select -----------------------------------------------------------

/**
 * Select a span and scroll it into view in ONE transaction. The selection IS the
 * find highlight in UWP; we additionally keep the persistent match highlights.
 */
function selectAndReveal(view: EditorView, span: MatchSpan): void {
  view.dispatch({
    selection: { anchor: span.from, head: span.to },
    effects: EditorView.scrollIntoView(span.from, { y: 'center' }),
    scrollIntoView: true,
  });
}

/**
 * Find-next from the current selection END, wrapping around the document end
 * (UWP TryFindNextAndSelect with stopAtEof=false). Selects + reveals the match.
 */
export function findNextInView(view: EditorView, q: FindQuery): FindOutcome {
  if (q.query.length === 0) return { match: null, wrapped: false };
  const text = docText(view);
  const { to } = selectionRange(view);

  const direct = findNext(text, q.query, q, to, false);
  if (direct) {
    selectAndReveal(view, direct);
    return { match: direct, wrapped: false };
  }
  const wrappedHit = findNext(text, q.query, q, 0, false);
  if (wrappedHit) {
    selectAndReveal(view, wrappedHit);
    return { match: wrappedHit, wrapped: true };
  }
  return { match: null, wrapped: false };
}

/**
 * Find-previous from the current selection START, wrapping to the document end
 * (UWP TryFindPreviousAndSelect with stopAtBof=false). Selects + reveals.
 */
export function findPreviousInView(view: EditorView, q: FindQuery): FindOutcome {
  if (q.query.length === 0) return { match: null, wrapped: false };
  const text = docText(view);
  const { from } = selectionRange(view);

  const direct = findPrevious(text, q.query, q, from, false);
  if (direct) {
    selectAndReveal(view, direct);
    return { match: direct, wrapped: false };
  }
  // Wrap: search from the document end.
  const wrappedHit = findPrevious(text, q.query, q, text.length, false);
  if (wrappedHit) {
    selectAndReveal(view, wrappedHit);
    return { match: wrappedHit, wrapped: true };
  }
  return { match: null, wrapped: false };
}

// --- Replace -----------------------------------------------------------------

/** Whether the current selection exactly equals a match of the query at its from. */
function selectionIsMatch(view: EditorView, q: FindQuery): boolean {
  const { from, to } = selectionRange(view);
  if (to <= from) return false;
  const text = docText(view);
  const hit = findNext(text, q.query, q, from, false);
  return hit !== null && hit.from === from && hit.to === to;
}

/**
 * Replace the current match and advance to the next (UWP TryFindNextAndReplace:
 * select→SetText→find-next). If the selection is not currently a match, this
 * first selects the next match (UWP collapses the selection then finds), then
 * replaces THAT. Regex replacement strings get the escape-sequence fix applied
 * by the engine; literal replacement is verbatim. Returns true if a replacement
 * happened.
 *
 * NOTE: the replacement transaction + the follow-up find are dispatched
 * separately, matching UWP (the SetText and the subsequent select are distinct
 * operations); each replace-one is therefore one undo step.
 */
export function replaceOne(view: EditorView, q: FindQuery, replacement: string): boolean {
  if (q.query.length === 0) return false;

  // Ensure a match is selected (UWP collapses selection to start, then finds).
  if (!selectionIsMatch(view, q)) {
    const found = findNextInView(view, q);
    if (!found.match) return false;
  }

  const { from, to } = selectionRange(view);
  const insert = q.useRegex ? expandRegexReplacement(view, q, from, to, replacement) : replacement;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });

  // Advance to the next match (UWP find-next after replace).
  findNextInView(view, q);
  return true;
}

/**
 * Expand a regex replacement for the SELECTED match. We re-run the regex against
 * the matched slice so '$1' group substitution + the \r/\n/\t escape fix are both
 * honored — the engine's replaceAll does this document-wide; here we scope it to
 * the single selected match so replace-one stays a one-occurrence edit.
 */
function expandRegexReplacement(
  view: EditorView,
  q: FindQuery,
  from: number,
  to: number,
  replacement: string,
): string {
  const slice = view.state.doc.sliceString(from, to);
  // replaceAll on the isolated slice yields exactly one substitution with the
  // engine's escape-sequence + $-group handling applied.
  const result = engineReplaceAll(slice, q.query, q, replacement);
  return result.count > 0 ? result.text : slice;
}

/**
 * Replace EVERY occurrence in the document as ONE transaction = ONE undo step
 * (UWP TryFindAndReplaceAll does a single SetText). Moves the caret to the
 * document end afterward (UWP sets StartPosition = int.MaxValue). Returns the
 * number of replacements.
 */
export function replaceAllInView(view: EditorView, q: FindQuery, replacement: string): number {
  if (q.query.length === 0) return 0;
  const text = docText(view);
  const result = engineReplaceAll(text, q.query, q, replacement);
  if (result.count === 0) return 0;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.text },
    selection: { anchor: result.text.length },
    scrollIntoView: true,
  });
  return result.count;
}

// --- Go to line --------------------------------------------------------------

/**
 * Move the caret to the start of 1-based `lineNumber`, clamped to the document's
 * line range, and reveal it (Ctrl+G). Returns the clamped line actually used.
 */
export function goToLine(view: EditorView, lineNumber: number): number {
  const lineCount = view.state.doc.lines;
  const clamped = Math.max(1, Math.min(lineNumber, lineCount));
  const line = view.state.doc.line(clamped);
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    scrollIntoView: true,
  });
  return clamped;
}
