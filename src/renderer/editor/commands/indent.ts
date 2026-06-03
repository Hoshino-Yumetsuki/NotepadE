/**
 * Indent / outdent (Tab / Shift+Tab) with tab-as-spaces — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.Indentation.cs (AddIndentation / RemoveIndentation)
 * onto the '\n' shadow buffer, reading the `tabAsSpaces` setting (-1 = real tab,
 * default; 2|4|8 = that many spaces) from the `editorSettings` facet.
 *
 * AddIndentation:
 *   - Single line (selection within one line, possibly collapsed): insert the
 *     indent string at the caret (UWP TypeText(tabStr) then collapse caret).
 *   - Multi-line selection: prefix EVERY spanned line with the indent string and
 *     keep the whole block selected, shifting the selection edges by the inserted
 *     widths.
 *
 * RemoveIndentation (Shift+Tab): for every spanned line, strip one indent level:
 *   - a leading real '\t' (one char), else
 *   - leading spaces: remove `indentAmount` spaces (indentAmount = setting, or 4
 *     when the setting is real-tab) UNLESS the leading run isn't a whole multiple,
 *     in which case only the remainder is removed (UWP `insufficientSpace`).
 *
 * One transaction = one undo step.
 */

import type { StateCommand, ChangeSpec } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import { editorSettings, indentString, type TabAsSpaces } from '../editorSettings';

/** Tab — indent. */
export const indentSelection: StateCommand = ({ state, dispatch }): boolean => {
  const tabAsSpaces = state.facet(editorSettings).tabAsSpaces;
  const tabStr = indentString(tabAsSpaces);
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  // Single-line (or collapsed) selection: insert the indent at the caret and
  // collapse the caret to after it (UWP TypeText then StartPosition=EndPosition).
  if (startLine.number === endLine.number) {
    dispatch(
      state.update(state.replaceSelection(tabStr), {
        scrollIntoView: true,
        userEvent: 'input.indent',
      }),
    );
    return true;
  }

  // Multi-line: prefix every spanned line; keep the block selected.
  const changes: ChangeSpec[] = [];
  const width = tabStr.length;
  let inserted = 0;
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    changes.push({ from: line.from, to: line.from, insert: tabStr });
    inserted += width;
  }
  // Shift selection: first line's prefix pushes everything; each later line adds
  // `width` to positions beyond it. Map the original offsets through the inserts.
  const firstWidth = width;
  const newAnchor = range.anchor + firstWidth;
  const newHead = range.head + (range.head === range.from ? firstWidth : inserted);
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.range(newAnchor, newHead),
      scrollIntoView: true,
      userEvent: 'input.indent',
    }),
  );
  return true;
};

/** Number of leading spaces in a line's text. */
function leadingSpaces(text: string): number {
  let n = 0;
  while (n < text.length && text[n] === ' ') n++;
  return n;
}

/** How many leading chars to strip from one line for one outdent level. */
function outdentWidthForLine(text: string, tabAsSpaces: TabAsSpaces): number {
  if (text.startsWith('\t')) return 1;
  const spaces = leadingSpaces(text);
  if (spaces === 0) return 0;
  const indentAmount = tabAsSpaces === -1 ? 4 : tabAsSpaces;
  const insufficient = spaces % indentAmount;
  return insufficient > 0 ? insufficient : Math.min(indentAmount, spaces);
}

/** Shift+Tab — outdent. */
export const outdentSelection: StateCommand = ({ state, dispatch }): boolean => {
  const tabAsSpaces = state.facet(editorSettings).tabAsSpaces;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  const changes: ChangeSpec[] = [];
  let removedBeforeAnchor = 0;
  let removedBeforeHead = 0;
  let removedTotal = 0;
  let anyChange = false;

  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    const w = outdentWidthForLine(line.text, tabAsSpaces);
    if (w === 0) continue;
    anyChange = true;
    changes.push({ from: line.from, to: line.from + w, insert: '' });
    removedTotal += w;
    // Track removals that occur before the anchor/head so we can shift them.
    if (line.from < range.anchor) removedBeforeAnchor += Math.min(w, range.anchor - line.from);
    if (line.from < range.head) removedBeforeHead += Math.min(w, range.head - line.from);
  }

  if (!anyChange) return false;
  void removedTotal;

  const newAnchor = Math.max(startLine.from, range.anchor - removedBeforeAnchor);
  const newHead = Math.max(startLine.from, range.head - removedBeforeHead);
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.range(newAnchor, newHead),
      scrollIntoView: true,
      userEvent: 'delete.outdent',
    }),
  );
  return true;
};
