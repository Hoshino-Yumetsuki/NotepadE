import { describe, it, expect } from 'vitest';
import { leadingSpacesAndTabs, autoIndentInsert } from './autoIndent';

describe('leadingSpacesAndTabs', () => {
  it('returns the leading spaces', () => {
    expect(leadingSpacesAndTabs('    abc')).toBe('    ');
  });

  it('returns the leading tabs', () => {
    expect(leadingSpacesAndTabs('\t\tabc')).toBe('\t\t');
  });

  it('returns empty string when no leading whitespace', () => {
    expect(leadingSpacesAndTabs('abc')).toBe('');
  });

  it('stops at the first non-whitespace char', () => {
    expect(leadingSpacesAndTabs('  a  b')).toBe('  ');
  });
});

describe('autoIndentInsert', () => {
  it('carries leading spaces onto the new line', () => {
    // caret at end of "    abc" (offset 7)
    expect(autoIndentInsert('    abc', 7)).toBe('\n    ');
  });

  it('carries leading tabs onto the new line', () => {
    // caret at end of "\t\tabc" (offset 5)
    expect(autoIndentInsert('\t\tabc', 5)).toBe('\n\t\t');
  });

  it('inserts a bare newline when there is no leading whitespace', () => {
    expect(autoIndentInsert('abc', 3)).toBe('\n');
  });

  it('measures indentation up to the caret column, not the whole line', () => {
    // caret at offset 1 of "  abc" — only one leading space before caret
    expect(autoIndentInsert('  abc', 1)).toBe('\n ');
  });

  it('uses the current line only (not a previous line)', () => {
    // "    abc\ncaret" — caret at offset 8 (start of second line)
    expect(autoIndentInsert('    abc\ncaret', 8)).toBe('\n');
  });
});
