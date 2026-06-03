/**
 * Move word(s) left / right (Alt+← / Alt+→) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.MoveText.cs (MoveTextLeft / MoveTextRight /
 * GetMovingWordsIndexData / MoveWords) onto the '\n' shadow buffer.
 *
 * "Word" boundaries use the .NET `char.IsLetterOrDigit` rule (letters + digits;
 * '_' is NOT a word char), matched here with the same \p{L}\p{N} test the search
 * engine uses. The command:
 *   1. Expands the current selection to whole words (the "moving" word(s)).
 *   2. Finds the adjacent word on the requested side (the "replaced" word).
 *   3. Swaps the two spans, keeping all text in between intact.
 *   4. Shifts the selection by the move amount so it tracks the moved word(s).
 *
 * One transaction = one undo step. No-op (returns false) at the document edges
 * or when there is no adjacent word to swap with — exactly like the UWP guards.
 */

import type { StateCommand } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';

function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Expand [selStart, selEnd) to whole-word boundaries, mirroring UWP
 * GetMovingWordsIndexData. Returns the widened [startIndex, endIndex).
 */
function movingWordSpan(doc: string, selStart: number, selEnd: number): { start: number; end: number } {
  let startIndex = selStart;
  if (selEnd === selStart || (selStart < doc.length && isLetterOrDigit(doc[selStart]))) {
    while (startIndex > 0) {
      startIndex--;
      if (!isLetterOrDigit(doc[startIndex])) {
        startIndex++;
        break;
      }
    }
  }

  const clampedEnd = selEnd > doc.length ? doc.length : selEnd;
  let endIndex = clampedEnd;
  if (selEnd === selStart || (clampedEnd > 0 && isLetterOrDigit(doc[clampedEnd - 1]))) {
    while (endIndex < doc.length) {
      endIndex++;
      if (!isLetterOrDigit(doc[endIndex - 1])) {
        endIndex--;
        break;
      }
    }
  }
  return { start: startIndex, end: endIndex };
}

/**
 * Swap the [leftStart,leftEnd) span with the [rightStart,rightEnd) span (the
 * left span must precede the right span). Returns the rebuilt document and the
 * new selection offsets shifted by `moveAmount`. Mirrors UWP MoveWords.
 */
function swapSpans(
  doc: string,
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
  selStart: number,
  selEnd: number,
  moveAmount: number,
): { text: string; from: number; to: number; anchor: number; head: number } {
  const leftWords = doc.slice(leftStart, leftEnd);
  const rightWords = doc.slice(rightStart, rightEnd);
  const middle = doc.slice(leftEnd, rightStart);
  // Rebuild only the affected region [leftStart, rightEnd): rightWords + middle + leftWords.
  const replacement = rightWords + middle + leftWords;
  return {
    text: replacement,
    from: leftStart,
    to: rightEnd,
    anchor: selStart + moveAmount,
    head: selEnd + moveAmount,
  };
}

export const moveWordLeft: StateCommand = ({ state, dispatch }): boolean => {
  const doc = state.doc.toString();
  const range = state.selection.main;
  const start = range.from;
  const end = range.to;
  if (start === 0) return false;

  const moving = movingWordSpan(doc, start, end);
  const startIndex = moving.start;
  const endIndex = moving.end;
  if (startIndex <= 0 || startIndex >= endIndex) return false;

  // Find the replaced (left-adjacent) word's [replacedStart, replacedEnd).
  let replacedEnd = startIndex;
  while (replacedEnd > 0) {
    replacedEnd--;
    if (isLetterOrDigit(doc[replacedEnd])) {
      replacedEnd++;
      break;
    }
  }
  let replacedStart = replacedEnd;
  while (replacedStart > 0) {
    replacedStart--;
    if (!isLetterOrDigit(doc[replacedStart])) {
      replacedStart++;
      break;
    }
  }

  const moveAmount = replacedStart - startIndex;
  const swap = swapSpans(doc, replacedStart, replacedEnd, startIndex, endIndex, start, end, moveAmount);
  let anchor = swap.anchor;
  if (anchor < 0) anchor = 0;
  dispatch(
    state.update({
      changes: { from: swap.from, to: swap.to, insert: swap.text },
      selection: EditorSelection.range(anchor, swap.head < 0 ? 0 : swap.head),
      scrollIntoView: true,
      userEvent: 'input.moveword',
    }),
  );
  return true;
};

export const moveWordRight: StateCommand = ({ state, dispatch }): boolean => {
  const doc = state.doc.toString();
  const range = state.selection.main;
  const start = range.from;
  const end = range.to;
  if (end >= doc.length) return false;

  const moving = movingWordSpan(doc, start, end);
  const startIndex = moving.start;
  const endIndex = moving.end;
  if (endIndex <= startIndex || endIndex >= doc.length) return false;

  // Find the replaced (right-adjacent) word's [replacedStart, replacedEnd).
  let replacedStart = endIndex;
  for (; replacedStart < doc.length; replacedStart++) {
    if (isLetterOrDigit(doc[replacedStart])) break;
  }
  let replacedEnd = replacedStart;
  for (; replacedEnd < doc.length; replacedEnd++) {
    if (!isLetterOrDigit(doc[replacedEnd])) break;
  }

  const moveAmount = replacedEnd - endIndex;
  const swap = swapSpans(doc, startIndex, endIndex, replacedStart, replacedEnd, start, end, moveAmount);
  dispatch(
    state.update({
      changes: { from: swap.from, to: swap.to, insert: swap.text },
      selection: EditorSelection.range(swap.anchor, swap.head),
      scrollIntoView: true,
      userEvent: 'input.moveword',
    }),
  );
  return true;
};
