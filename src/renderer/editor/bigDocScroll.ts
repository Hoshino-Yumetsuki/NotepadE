/**
 * ============================================================================
 *  Big-document scroll stabilizer — pin the cursor line on huge-file edits
 * ============================================================================
 *
 * In a very large document (~920k lines) CodeMirror 6 swaps its height model to
 * the BigScaler: the DOM can't be taller than ~7,000,000px, so CM6 keeps the
 * current viewport at 1:1 and COMPRESSES everything outside it, with a global
 * `scale = (7e6 − vpHeight) / (heightMap.height − vpHeight)`.
 *
 * Every edit changes `heightMap.height` (any insert/delete adds or removes a
 * row), so the global `scale` changes on EVERY edit. CM6's built-in scroll
 * anchoring then tries to hold one anchor line by nudging `scrollTop` by
 * `(newAnchorTop − oldAnchorTop) / scaleY` — but that correction (a) only fires
 * past a 1px threshold and (b) holds a SINGLE line while every other line's DOM
 * position is recomputed at the new scale. The net effect on a mid-file insert
 * is a visible viewport jump: content both above and below the caret shifts.
 *
 * Fix (structural, not heuristic): for large docs, attach an explicit
 * `EditorView.scrollIntoView(head, { y: "nearest" })` to any USER doc-changing
 * transaction that doesn't already carry a scroll target. This routes the update
 * through CM6's DETERMINISTIC scrollTarget path (it measures the caret rect and
 * scrolls exactly enough to satisfy `y:"nearest"`) instead of the fragile
 * anchor-diff correction. Because the caret line is already on screen during a
 * mid-file insert, `y:"nearest"` scrolls by ZERO — the caret line holds its exact
 * screen position and the surrounding content stops jumping.
 *
 * Scoped tightly:
 *   - only `docChanged` transactions (find/goto move the caret without changing
 *     the doc, so their own centered scroll target is never touched);
 *   - only USER input/delete/move transactions — programmatic setDoc /
 *     reconfigure carry no userEvent and are left alone;
 *   - only when the transaction doesn't ALREADY request a scroll
 *     (`tr.scrollIntoView` — every editor command that edits text, e.g. Enter /
 *     duplicate / indent / datetime / moveLines, sets this flag, so we never
 *     double-anchor or fight a command's own intended scroll);
 *   - only past a line-count threshold safely below the BigScaler onset, so
 *     normal-size documents keep CM6's native behavior verbatim.
 *
 * PA-8: pure renderer + CM6 transaction filter. No fs/path/child_process, no IPC.
 */

import { EditorView } from '@codemirror/view';
import { EditorState, type Extension, type TransactionSpec } from '@codemirror/state';

/**
 * Line count past which we force the explicit cursor anchor. BigScaler engages
 * when the document height exceeds ~7,000,000px; at the editor's ~17px default
 * line height that is ~410k lines. We gate well above a normal large file but
 * comfortably below the BigScaler onset so the stabilizer covers the whole
 * scaled regime (and a margin of approach to it) without touching ordinary docs.
 */
export const BIG_DOC_LINE_THRESHOLD = 200_000;

/**
 * Transaction filter: append a cursor `scrollIntoView({y:"nearest"})` to large-
 * doc user edits that don't already carry one, forcing CM6's deterministic
 * scroll path and defeating the BigScaler anchor jump.
 */
export const bigDocScrollStabilizer: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  // Only user input — never reshape programmatic loads/reconfigures.
  if (!tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('move')) {
    return tr;
  }
  // A command (Enter, duplicate, indent, datetime, moveLines, ...) already asked
  // for its own scroll — don't override or duplicate it.
  if (tr.scrollIntoView) return tr;
  if (tr.newDoc.lines < BIG_DOC_LINE_THRESHOLD) return tr;
  const head = tr.newSelection.main.head;
  const spec: TransactionSpec = {
    effects: EditorView.scrollIntoView(head, { y: 'nearest' })
  };
  return [tr, spec];
});
