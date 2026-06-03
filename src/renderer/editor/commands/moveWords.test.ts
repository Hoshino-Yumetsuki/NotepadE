import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { moveWordLeft, moveWordRight } from './moveWords';
import { runStateCommand } from './testUtils';

/**
 * Move word(s) left / right (Alt+← / Alt+→) parity. Expands the selection to
 * whole words (letters+digits; '_' is a boundary), swaps with the adjacent word
 * on the requested side, keeps the in-between text intact. No-op at edges.
 */

describe('moveWordRight', () => {
  it('swaps the current word with the next word', () => {
    // caret inside "foo" of "foo bar"
    const r = runStateCommand(moveWordRight, 'foo bar', EditorSelection.cursor(1));
    expect(r.doc).toBe('bar foo');
  });

  it('keeps the separator between the two words', () => {
    const r = runStateCommand(moveWordRight, 'one  two', EditorSelection.cursor(0));
    expect(r.doc).toBe('two  one');
  });

  it('is a no-op when there is no word to the right', () => {
    const r = runStateCommand(moveWordRight, 'foo', EditorSelection.cursor(1));
    expect(r.doc).toBe('foo');
    expect(r.changed).toBe(false);
  });
});

describe('moveWordLeft', () => {
  it('swaps the current word with the previous word', () => {
    // caret inside "bar" of "foo bar"
    const r = runStateCommand(moveWordLeft, 'foo bar', EditorSelection.cursor(5));
    expect(r.doc).toBe('bar foo');
  });

  it('is a no-op when the caret is at the start of the document', () => {
    const r = runStateCommand(moveWordLeft, 'foo bar', EditorSelection.cursor(0));
    expect(r.doc).toBe('foo bar');
    expect(r.changed).toBe(false);
  });
});
