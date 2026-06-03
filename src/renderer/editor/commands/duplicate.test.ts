import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { duplicateLineOrSelection } from './duplicate';
import { runStateCommand } from './testUtils';

/**
 * Duplicate (Ctrl+D) parity (RENDERER, Lane B). Drives a real EditorState and
 * asserts the doc/selection transform of duplicate.ts:
 *   - collapsed caret → duplicate the whole line below, caret on same column of
 *     the copy.
 *   - non-empty selection → duplicate selected text after the selection, the new
 *     selection covering the inserted copy.
 */

describe('duplicateLineOrSelection', () => {
  it('duplicates the whole line below when the caret is collapsed', () => {
    const r = runStateCommand(duplicateLineOrSelection, 'abc\ndef', EditorSelection.cursor(2));
    expect(r.doc).toBe('abc\nabc\ndef');
    // caret on the duplicated (lower) line at the same column 2 → offset 4+2=6
    expect(r.head).toBe(6);
    expect(r.anchor).toBe(6);
  });

  it('keeps the caret column on the copy for a single-line doc', () => {
    const r = runStateCommand(duplicateLineOrSelection, 'hello', EditorSelection.cursor(0));
    expect(r.doc).toBe('hello\nhello');
    expect(r.head).toBe(6); // line.to(5) + 1 + column(0)
  });

  it('duplicates the selected text after the selection and selects the copy', () => {
    const r = runStateCommand(duplicateLineOrSelection, 'abcd', EditorSelection.range(1, 3));
    expect(r.doc).toBe('abcbcd');
    expect(r.from).toBe(3);
    expect(r.to).toBe(5);
  });

  it('repeated duplicate of a selection keeps extending', () => {
    let state = EditorState.create({ doc: 'xy', selection: EditorSelection.range(0, 2) });
    const dispatch = (tr: { state: EditorState }): void => {
      state = tr.state;
    };
    duplicateLineOrSelection({ state, dispatch });
    duplicateLineOrSelection({ state, dispatch });
    expect(state.doc.toString()).toBe('xyxyxy');
  });
});
