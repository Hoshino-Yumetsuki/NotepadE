import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { joinLines } from './joinLines';
import { runStateCommand } from './testUtils';

/**
 * Join lines (Ctrl+J) parity. Joins the lines SPANNED by the selection with a
 * single space; no-op when the selection stays within one line.
 */

describe('joinLines', () => {
  it('joins the spanned lines with a single space', () => {
    // selection spans line 1 ("abc") into line 2 ("def"): caret 1..5
    const r = runStateCommand(joinLines, 'abc\ndef', EditorSelection.range(1, 5));
    expect(r.doc).toBe('abc def');
    expect(r.changed).toBe(true);
  });

  it('joins three spanned lines with single spaces', () => {
    const r = runStateCommand(joinLines, 'a\nb\nc', EditorSelection.range(0, 5));
    expect(r.doc).toBe('a b c');
  });

  it('is a no-op when the selection stays within a single line', () => {
    const r = runStateCommand(joinLines, 'abc\ndef', EditorSelection.range(0, 2));
    expect(r.doc).toBe('abc\ndef');
    expect(r.changed).toBe(false);
  });

  it('is a no-op for a collapsed caret', () => {
    const r = runStateCommand(joinLines, 'abc\ndef', EditorSelection.cursor(1));
    expect(r.doc).toBe('abc\ndef');
    expect(r.changed).toBe(false);
  });
});
