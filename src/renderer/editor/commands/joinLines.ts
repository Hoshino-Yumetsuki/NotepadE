/**
 * Join lines with a single space (Ctrl+J) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.JoinText.cs observable behavior on the '\n' shadow
 * buffer:
 *   - Operates on the full set of lines SPANNED by the current selection
 *     (from the selection's start line through its end line).
 *   - "Does not make any sense to join 1 line" → if the selection stays within a
 *     single line, it is a no-op (UWP returns early when startLine == endLine).
 *   - The spanned lines are replaced by their texts joined with a single ' '.
 *   - UWP restores the original selection range (SetRange(start, end)); we keep
 *     the caret/selection at the same document offsets, clamped into the result.
 *
 * One transaction = one undo step.
 */

import type { StateCommand } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';

export const joinLines: StateCommand = ({ state, dispatch }): boolean => {
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);

  // No sense joining a single line (UWP early-return on startLine == endLine).
  if (startLine.number === endLine.number) return false;

  const parts: string[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    parts.push(state.doc.line(n).text);
  }
  const joined = parts.join(' ');

  const from = startLine.from;
  const to = endLine.to;
  if (joined === state.sliceDoc(from, to)) return false;

  // Preserve the original selection offsets, clamped to the shortened region.
  const clamp = (pos: number): number => (pos > from + joined.length ? from + joined.length : pos);
  const anchor = clamp(range.anchor);
  const head = clamp(range.head);

  dispatch(
    state.update({
      changes: { from, to, insert: joined },
      selection: EditorSelection.range(anchor, head),
      scrollIntoView: true,
      userEvent: 'input.join',
    }),
  );
  return true;
};
