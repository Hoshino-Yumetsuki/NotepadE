/**
 * Duplicate line / selection (Ctrl+D) — RENDERER, Lane B.
 *
 * Ports the OBSERVABLE behavior of UWP TextEditorCore.DuplicateText.cs (the
 * RichEditBox offset gymnastics there are internal; we replicate the user-
 * visible result on the '\n' shadow buffer):
 *
 *   - No selection (collapsed caret): duplicate the WHOLE current line. The copy
 *     is inserted as a new line directly below, and the caret moves to the same
 *     column on the duplicated (lower) line. (UWP appends `\n + line` after the
 *     line end and places the caret on the new copy.)
 *   - Non-empty selection: duplicate the exact selected text. The duplicate is
 *     inserted immediately after the selection; the new selection covers the
 *     inserted copy (so repeated Ctrl+D keeps duplicating).
 *
 * One transaction = one undo step.
 */

import type { StateCommand } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';

export const duplicateLineOrSelection: StateCommand = ({ state, dispatch }): boolean => {
  const range = state.selection.main;

  if (range.empty) {
    // Duplicate the current line below; keep the caret column on the copy.
    const line = state.doc.lineAt(range.head);
    const column = range.head - line.from;
    // Insert "\n" + lineText at the line END so a new line appears below.
    const insert = '\n' + line.text;
    const newHead = line.to + 1 + column;
    dispatch(
      state.update({
        changes: { from: line.to, to: line.to, insert },
        selection: EditorSelection.cursor(newHead),
        scrollIntoView: true,
        userEvent: 'input.duplicate'
      })
    );
    return true;
  }

  // Duplicate the selected text immediately after the selection; select the copy.
  const text = state.sliceDoc(range.from, range.to);
  dispatch(
    state.update({
      changes: { from: range.to, to: range.to, insert: text },
      selection: EditorSelection.range(range.to, range.to + text.length),
      scrollIntoView: true,
      userEvent: 'input.duplicate'
    })
  );
  return true;
};
