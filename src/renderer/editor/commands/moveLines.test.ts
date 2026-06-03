import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { moveLinesUp, moveLinesDown } from './moveLines';
import { runStateCommand } from './testUtils';

/**
 * Move line(s) up / down (Alt+↑ / Alt+↓) parity. Operates on the lines SPANNED
 * by the selection; no-op at the document edges. Selection tracks the block.
 */

describe('moveLinesUp', () => {
  it('swaps the current line with the one above', () => {
    // caret on line 2 ("b")
    const r = runStateCommand(moveLinesUp, 'a\nb\nc', EditorSelection.cursor(2));
    expect(r.doc).toBe('b\na\nc');
  });

  it('is a no-op when the first spanned line is line 1', () => {
    const r = runStateCommand(moveLinesUp, 'a\nb\nc', EditorSelection.cursor(0));
    expect(r.doc).toBe('a\nb\nc');
    expect(r.changed).toBe(false);
  });

  it('moves a multi-line block up together', () => {
    // select lines 2-3 ("b","c"): offsets 2..5
    const r = runStateCommand(moveLinesUp, 'a\nb\nc', EditorSelection.range(2, 5));
    expect(r.doc).toBe('b\nc\na');
  });
});

describe('moveLinesDown', () => {
  it('swaps the current line with the one below', () => {
    const r = runStateCommand(moveLinesDown, 'a\nb\nc', EditorSelection.cursor(0));
    expect(r.doc).toBe('b\na\nc');
  });

  it('is a no-op when the last spanned line is the final line', () => {
    const r = runStateCommand(moveLinesDown, 'a\nb\nc', EditorSelection.cursor(4));
    expect(r.doc).toBe('a\nb\nc');
    expect(r.changed).toBe(false);
  });

  it('moves a multi-line block down together', () => {
    // select lines 1-2 ("a","b"): offsets 0..3
    const r = runStateCommand(moveLinesDown, 'a\nb\nc', EditorSelection.range(0, 3));
    expect(r.doc).toBe('c\na\nb');
  });
});
