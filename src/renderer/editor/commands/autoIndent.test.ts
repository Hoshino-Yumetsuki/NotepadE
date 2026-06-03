import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { enterWithAutoIndent } from './autoIndent';
import { runStateCommand } from './testUtils';

/**
 * Enter / Shift+Enter auto-indent parity. Inserts '\n' + the leading whitespace
 * (spaces/tabs) of the text before the caret on the current line.
 */

describe('enterWithAutoIndent', () => {
  it('carries the leading spaces onto the new line', () => {
    // caret at end of "    abc" (offset 7)
    const r = runStateCommand(enterWithAutoIndent, '    abc', EditorSelection.cursor(7));
    expect(r.doc).toBe('    abc\n    ');
    expect(r.head).toBe(12); // 7 + '\n'(1) + 4 spaces
  });

  it('carries leading tabs onto the new line', () => {
    // caret at end of "\t\tabc" (offset 5)
    const r = runStateCommand(enterWithAutoIndent, '\t\tabc', EditorSelection.cursor(5));
    expect(r.doc).toBe('\t\tabc\n\t\t');
  });

  it('inserts a bare newline when there is no leading whitespace', () => {
    const r = runStateCommand(enterWithAutoIndent, 'abc', EditorSelection.cursor(3));
    expect(r.doc).toBe('abc\n');
  });

  it('measures indentation up to the caret column, not the whole line', () => {
    // caret between the two leading spaces (offset 1) of "  abc"
    const r = runStateCommand(enterWithAutoIndent, '  abc', EditorSelection.cursor(1));
    // before-caret text is " " → indent is one space
    expect(r.doc).toBe(' \n  abc');
  });

  it('replaces an active selection before inserting', () => {
    // select "abc" (0..3) in "abc"; indent before selection start is empty
    const r = runStateCommand(enterWithAutoIndent, 'abc', EditorSelection.range(0, 3));
    expect(r.doc).toBe('\n');
  });
});
