import { describe, it, expect } from 'vitest';
import {
  leadingSpaces,
  outdentWidthForLine,
  indentString,
  splitLines,
  outdentRange
} from './indent';

describe('leadingSpaces', () => {
  it('counts leading spaces', () => {
    expect(leadingSpaces('   abc')).toBe(3);
  });

  it('stops at tabs', () => {
    expect(leadingSpaces('\tabc')).toBe(0);
  });

  it('returns 0 for no leading spaces', () => {
    expect(leadingSpaces('abc')).toBe(0);
  });
});

describe('outdentWidthForLine', () => {
  it('strips one leading tab (real-tab mode)', () => {
    expect(outdentWidthForLine('\tabc', -1)).toBe(1);
  });

  it('strips 2 leading spaces when tabAsSpaces = 2', () => {
    expect(outdentWidthForLine('  abc', 2)).toBe(2);
  });

  it('strips 4 leading spaces when tabAsSpaces = 4', () => {
    expect(outdentWidthForLine('    abc', 4)).toBe(4);
  });

  it('strips 8 leading spaces when tabAsSpaces = 8', () => {
    expect(outdentWidthForLine('        abc', 8)).toBe(8);
  });

  it('strips only the partial remainder when not a whole multiple', () => {
    // 3 spaces, indentAmount 4 → insufficient = 3 % 4 = 3, strip 3
    expect(outdentWidthForLine('   abc', 4)).toBe(3);
  });

  it('falls back to 4-space width in real-tab mode', () => {
    // 6 spaces, indentAmount 4 → insufficient = 6 % 4 = 2, strip 2
    expect(outdentWidthForLine('      abc', -1)).toBe(2);
  });

  it('returns 0 when no leading whitespace', () => {
    expect(outdentWidthForLine('abc', 4)).toBe(0);
  });
});

describe('indentString', () => {
  it('returns a real tab for -1', () => {
    expect(indentString(-1)).toBe('\t');
  });

  it('returns 2 spaces for 2', () => {
    expect(indentString(2)).toBe('  ');
  });

  it('returns 4 spaces for 4', () => {
    expect(indentString(4)).toBe('    ');
  });

  it('returns 8 spaces for 8', () => {
    expect(indentString(8)).toBe('        ');
  });
});

describe('splitLines', () => {
  it('splits a two-line document correctly', () => {
    const lines = splitLines('abc\ndef');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ text: 'abc', from: 0, to: 3 });
    expect(lines[1]).toEqual({ text: 'def', from: 4, to: 7 });
  });

  it('handles a single line', () => {
    const lines = splitLines('hello');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ text: 'hello', from: 0, to: 5 });
  });
});

describe('outdentRange', () => {
  it('outdents a single line with a tab', () => {
    const r = outdentRange('\tabc', 1, 1, 1, 1, -1);
    expect(r.anyChange).toBe(true);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toEqual({ from: 0, to: 1, insert: '' });
  });

  it('is no-op when no leading whitespace', () => {
    const r = outdentRange('abc', 0, 0, 0, 0, 4);
    expect(r.anyChange).toBe(false);
    expect(r.changes).toHaveLength(0);
  });

  it('outdents multiple lines', () => {
    const r = outdentRange('    a\n    b', 0, 10, 0, 10, 4);
    expect(r.anyChange).toBe(true);
    expect(r.changes).toHaveLength(2);
    // Each change strips 4 spaces from line start
    expect(r.changes[0]).toEqual({ from: 0, to: 4, insert: '' });
    expect(r.changes[1]).toEqual({ from: 6, to: 10, insert: '' });
  });
});
