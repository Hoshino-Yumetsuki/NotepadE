import { describe, it, expect } from 'vitest';
import {
  compileQuery,
  findAllRegexMatches,
  findNext,
  findPrevious,
  applyEscapeSequenceFix,
  replaceAll,
  type SearchOptions
} from './searchEngine';

/**
 * Pure search-engine parity tests (RENDERER, Lane B). Pins the UWP behavior
 * replicated in searchEngine.ts WITHOUT CodeMirror or Electron:
 *   - literal IndexOf / LastIndexOf (Ordinal / OrdinalIgnoreCase) + wrap-around
 *   - whole-word via char.IsLetterOrDigit neighbours (NOT \b; '_' is a boundary)
 *   - regex (Multiline, +IgnoreCase unless match-case)
 *   - RightToLeft find-previous SHIM (divergence #5): forward-match-all then pick
 *     the last match ending at/before the caret
 *   - replaceAll over the whole doc (one transaction = one undo step)
 *   - regex-replacement escape-sequence fix (\r \n \t)
 */

const LITERAL: SearchOptions = { matchCase: false, wholeWord: false, useRegex: false };
const LITERAL_CASE: SearchOptions = { matchCase: true, wholeWord: false, useRegex: false };
const WHOLE_WORD: SearchOptions = { matchCase: false, wholeWord: true, useRegex: false };
const REGEX: SearchOptions = { matchCase: false, wholeWord: false, useRegex: true };
const REGEX_CASE: SearchOptions = { matchCase: true, wholeWord: false, useRegex: true };

describe('compileQuery', () => {
  it('always succeeds for an empty query', () => {
    expect(compileQuery('', REGEX)).toEqual({ ok: true });
    expect(compileQuery('', LITERAL)).toEqual({ ok: true });
  });

  it('always succeeds for a literal query (verbatim, never parsed)', () => {
    expect(compileQuery('(unbalanced', LITERAL)).toEqual({ ok: true });
    expect(compileQuery('a\\b[', LITERAL)).toEqual({ ok: true });
  });

  it('succeeds for a valid regex', () => {
    expect(compileQuery('a.*b', REGEX)).toEqual({ ok: true });
  });

  it('reports the engine error for an invalid regex', () => {
    const r = compileQuery('(', REGEX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(typeof r.error).toBe('string');
  });
});

describe('findNext (literal)', () => {
  const text = 'foo bar foo baz foo';

  it('finds the first match at or after `from`', () => {
    expect(findNext(text, 'foo', LITERAL, 0, false)).toEqual({ from: 0, to: 3 });
    expect(findNext(text, 'foo', LITERAL, 1, false)).toEqual({ from: 8, to: 11 });
  });

  it('returns null at EOF when wrap is false', () => {
    expect(findNext(text, 'foo', LITERAL, 17, false)).toBeNull();
  });

  it('wraps to the document start when wrap is true', () => {
    expect(findNext(text, 'foo', LITERAL, 17, true)).toEqual({ from: 0, to: 3 });
  });

  it('returns null for an empty query', () => {
    expect(findNext(text, '', LITERAL, 0, true)).toBeNull();
  });

  it('clamps an out-of-range `from`', () => {
    expect(findNext(text, 'foo', LITERAL, 9999, true)).toEqual({ from: 0, to: 3 });
    expect(findNext(text, 'foo', LITERAL, -5, false)).toEqual({ from: 0, to: 3 });
  });
});

describe('findNext (match-case)', () => {
  const text = 'Foo foo FOO';

  it('case-insensitive matches any casing', () => {
    expect(findNext(text, 'foo', LITERAL, 0, false)).toEqual({ from: 0, to: 3 });
  });

  it('case-sensitive matches only exact casing', () => {
    expect(findNext(text, 'foo', LITERAL_CASE, 0, false)).toEqual({ from: 4, to: 7 });
    expect(findNext(text, 'FOO', LITERAL_CASE, 0, false)).toEqual({ from: 8, to: 11 });
    expect(findNext(text, 'fOo', LITERAL_CASE, 0, true)).toBeNull();
  });
});

describe('findNext (whole-word)', () => {
  // 'cat' standalone at 0; inside 'category' at 12; standalone again at 25.
  const text = 'cat dog the category and cat';

  it('matches only standalone words, skipping substrings', () => {
    expect(findNext(text, 'cat', WHOLE_WORD, 0, false)).toEqual({ from: 0, to: 3 });
    // From after the first match, the 'cat' inside 'category' is skipped.
    expect(findNext(text, 'cat', WHOLE_WORD, 1, false)).toEqual({ from: 25, to: 28 });
  });

  it("treats '_' as a boundary (NOT a word char, unlike regex \\b)", () => {
    // 'cat_' — underscore is NOT letter-or-digit, so 'cat' is whole-word here.
    expect(findNext('cat_x', 'cat', WHOLE_WORD, 0, false)).toEqual({ from: 0, to: 3 });
    // 'xcat' — preceding 'x' IS a word char, so not a whole word.
    expect(findNext('xcat', 'cat', WHOLE_WORD, 0, false)).toBeNull();
  });

  it('wraps for whole-word too', () => {
    expect(findNext(text, 'cat', WHOLE_WORD, 26, true)).toEqual({ from: 0, to: 3 });
  });
});

describe('findPrevious (literal)', () => {
  const text = 'foo bar foo baz foo';

  it('finds the nearest match strictly before the caret', () => {
    // Caret at 19 (EOF): previous is the last 'foo' at 16.
    expect(findPrevious(text, 'foo', LITERAL, 19, false)).toEqual({ from: 16, to: 19 });
    // Caret at 16: previous is the middle 'foo' at 8.
    expect(findPrevious(text, 'foo', LITERAL, 16, false)).toEqual({ from: 8, to: 11 });
  });

  it('wraps to the document end when caret is at BOF and wrap is true', () => {
    expect(findPrevious(text, 'foo', LITERAL, 0, true)).toEqual({ from: 16, to: 19 });
  });

  it('returns null at BOF when wrap is false', () => {
    expect(findPrevious(text, 'foo', LITERAL, 0, false)).toBeNull();
  });

  it('returns null for an empty query', () => {
    expect(findPrevious(text, '', LITERAL, 19, true)).toBeNull();
  });
});

describe('findPrevious (whole-word)', () => {
  const text = 'cat dog the category and cat';

  it('skips substring matches scanning backwards', () => {
    // Caret at 28 (EOF). Last standalone 'cat' is at 25.
    expect(findPrevious(text, 'cat', WHOLE_WORD, 28, false)).toEqual({ from: 25, to: 28 });
    // Caret at 25: skip 'cat' inside 'category', land on the first 'cat' at 0.
    expect(findPrevious(text, 'cat', WHOLE_WORD, 25, false)).toEqual({ from: 0, to: 3 });
  });
});

describe('findNext / findPrevious (regex)', () => {
  const text = 'a1 b2 c3 d4';

  it('finds the next regex match from a position', () => {
    expect(findNext(text, '[a-z]\\d', REGEX, 0, false)).toEqual({ from: 0, to: 2 });
    expect(findNext(text, '[a-z]\\d', REGEX, 1, false)).toEqual({ from: 3, to: 5 });
  });

  it('wraps regex find-next', () => {
    expect(findNext(text, '[a-z]\\d', REGEX, 11, true)).toEqual({ from: 0, to: 2 });
    expect(findNext(text, '[a-z]\\d', REGEX, 11, false)).toBeNull();
  });

  it('regex is case-insensitive unless match-case', () => {
    expect(findNext('ABC', 'abc', REGEX, 0, false)).toEqual({ from: 0, to: 3 });
    expect(findNext('ABC', 'abc', REGEX_CASE, 0, false)).toBeNull();
  });

  it('uses Multiline so ^ / $ match line boundaries', () => {
    const multi = 'one\ntwo\nthree';
    // '^t' should match the start of 'two' and 'three'.
    expect(findNext(multi, '^t', REGEX, 0, false)).toEqual({ from: 4, to: 5 });
    expect(findNext(multi, '^t', REGEX, 5, false)).toEqual({ from: 8, to: 9 });
  });
});

describe('findAllRegexMatches', () => {
  it('collects every forward match in ascending order', () => {
    expect(findAllRegexMatches('a1 b2 c3', '[a-z]\\d', REGEX)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 }
    ]);
  });

  it('does not loop forever on a zero-width match', () => {
    // 'a*' matches empty between every char; just assert it terminates and the
    // first span is zero-width at 0.
    const spans = findAllRegexMatches('xx', 'a*', REGEX);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]).toEqual({ from: 0, to: 0 });
  });

  it('returns [] for an empty query', () => {
    expect(findAllRegexMatches('abc', '', REGEX)).toEqual([]);
  });

  it('returns [] for an invalid regex (caller compiles to surface the error)', () => {
    expect(findAllRegexMatches('abc', '(', REGEX)).toEqual([]);
  });
});

describe('findPrevious (regex) — RightToLeft shim, divergence #5', () => {
  const text = 'a1 b2 c3 d4';

  it('picks the LAST match ending at or before the caret', () => {
    // Caret at 11 (EOF): rightmost match is 'd4' at 9.
    expect(findPrevious(text, '[a-z]\\d', REGEX, 11, false)).toEqual({ from: 9, to: 11 });
    // Caret at 8 (end of 'c3'): 'c3' ends at 8 (<=8) so it qualifies.
    expect(findPrevious(text, '[a-z]\\d', REGEX, 8, false)).toEqual({ from: 6, to: 8 });
    // Caret at 7 (mid 'c3'): 'c3' ends at 8 (>7) so it's excluded; 'b2' at 3.
    expect(findPrevious(text, '[a-z]\\d', REGEX, 7, false)).toEqual({ from: 3, to: 5 });
  });

  it('returns null at BOF when no match qualifies and wrap is false', () => {
    expect(findPrevious(text, '[a-z]\\d', REGEX, 0, false)).toBeNull();
  });

  it('wraps to the rightmost (last) match overall when wrap is true', () => {
    // Nothing ends at/before caret 0, so the wrap yields the doc-final match.
    expect(findPrevious(text, '[a-z]\\d', REGEX, 0, true)).toEqual({ from: 9, to: 11 });
  });

  it('returns null when the pattern never matches', () => {
    expect(findPrevious(text, 'zzz', REGEX, 11, true)).toBeNull();
  });
});

describe('applyEscapeSequenceFix', () => {
  it('expands \\r, \\n, \\t in that order', () => {
    expect(applyEscapeSequenceFix('a\\rb\\nc\\td')).toBe('a\rb\nc\td');
  });

  it('leaves other backslash sequences untouched', () => {
    expect(applyEscapeSequenceFix('\\d\\w')).toBe('\\d\\w');
  });

  it('is a no-op when there are no escapes', () => {
    expect(applyEscapeSequenceFix('plain')).toBe('plain');
  });
});

describe('replaceAll (literal)', () => {
  it('replaces every occurrence verbatim and counts them', () => {
    const r = replaceAll('foo foo foo', 'foo', LITERAL, 'bar');
    expect(r).toEqual({ text: 'bar bar bar', count: 3 });
  });

  it('does not re-scan inserted replacement text', () => {
    // Replacing 'a' with 'aa' must not cascade.
    const r = replaceAll('aaa', 'a', LITERAL, 'aa');
    expect(r).toEqual({ text: 'aaaaaa', count: 3 });
  });

  it('is verbatim — no $ substitution in literal mode', () => {
    const r = replaceAll('x', 'x', LITERAL, '$1&');
    expect(r).toEqual({ text: '$1&', count: 1 });
  });

  it('respects whole-word in replace-all', () => {
    const r = replaceAll('cat category cat', 'cat', WHOLE_WORD, 'dog');
    expect(r).toEqual({ text: 'dog category dog', count: 2 });
  });

  it('respects match-case in replace-all', () => {
    const r = replaceAll('Foo foo', 'foo', LITERAL_CASE, 'bar');
    expect(r).toEqual({ text: 'Foo bar', count: 1 });
  });

  it('returns the text unchanged with count 0 when nothing matches', () => {
    const r = replaceAll('abc', 'zzz', LITERAL, 'q');
    expect(r).toEqual({ text: 'abc', count: 0 });
  });

  it('returns count 0 for an empty query', () => {
    const r = replaceAll('abc', '', LITERAL, 'q');
    expect(r).toEqual({ text: 'abc', count: 0 });
  });
});

describe('replaceAll (regex)', () => {
  it('replaces every match in one pass and counts them', () => {
    const r = replaceAll('a1 b2 c3', '[a-z]\\d', REGEX, 'X');
    expect(r).toEqual({ text: 'X X X', count: 3 });
  });

  it('expands replacement escape sequences (\\r \\n \\t) in regex mode', () => {
    const r = replaceAll('a,b', ',', REGEX, '\\n');
    expect(r).toEqual({ text: 'a\nb', count: 1 });
  });

  it('supports $-group substitution (native RegExp.replace)', () => {
    const r = replaceAll('john smith', '(\\w+) (\\w+)', REGEX, '$2 $1');
    expect(r).toEqual({ text: 'smith john', count: 1 });
  });

  it('returns count 0 / unchanged when the regex never matches', () => {
    const r = replaceAll('abc', '\\d', REGEX, 'X');
    expect(r).toEqual({ text: 'abc', count: 0 });
  });

  it('returns count 0 for an invalid regex', () => {
    const r = replaceAll('abc', '(', REGEX, 'X');
    expect(r).toEqual({ text: 'abc', count: 0 });
  });
});
