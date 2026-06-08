/**
 * Move line(s) up / down (Alt+↑ / Alt+↓) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.MoveText.cs (MoveTextUp / MoveTextDown / MoveLines)
 * onto the '\n' shadow buffer. The command operates on the WHOLE set of lines
 * SPANNED by the current selection:
 *   - Up: no-op when the first spanned line is already line 1.
 *   - Down: no-op when the last spanned line is already the final line.
 *   - The spanned block of lines is swapped with the single adjacent line on the
 *     requested side; the selection moves with the block so repeated presses keep
 *     dragging it.
 *
 * One transaction = one undo step.
 */

import type { StateCommand } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';

/** Move the selected line block up by one line. */
export const moveLinesUp: StateCommand = ({ state, dispatch }): boolean => {
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  // Already at the top — nothing above to swap with (UWP: startLine == 1).
  if (startLine.number === 1) return false;

  const prev = state.doc.line(startLine.number - 1);

  // The block of text (without surrounding line breaks) being moved.
  const block = state.sliceDoc(startLine.from, endLine.to);
  // Rebuild [prev.from, endLine.to) as block + '\n' + prevText.
  const insert = block + '\n' + prev.text;
  // The block shifts up by (prev.length + 1) characters.
  const shift = prev.text.length + 1;

  dispatch(
    state.update({
      changes: { from: prev.from, to: endLine.to, insert },
      selection: EditorSelection.range(range.anchor - shift, range.head - shift),
      scrollIntoView: true,
      userEvent: 'move.line'
    })
  );
  return true;
};

/** Move the selected line block down by one line. */
export const moveLinesDown: StateCommand = ({ state, dispatch }): boolean => {
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  // Already at the bottom — nothing below to swap with (UWP: endLine == count).
  if (endLine.number === state.doc.lines) return false;

  const next = state.doc.line(endLine.number + 1);

  const block = state.sliceDoc(startLine.from, endLine.to);
  // Rebuild [startLine.from, next.to) as nextText + '\n' + block.
  const insert = next.text + '\n' + block;
  // The block shifts down by (next.length + 1) characters.
  const shift = next.text.length + 1;

  dispatch(
    state.update({
      changes: { from: startLine.from, to: next.to, insert },
      selection: EditorSelection.range(range.anchor + shift, range.head + shift),
      scrollIntoView: true,
      userEvent: 'move.line'
    })
  );
  return true;
};
