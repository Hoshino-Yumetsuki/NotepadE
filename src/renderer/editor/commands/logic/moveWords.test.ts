import { describe, it, expect } from 'vitest';
import { isLetterOrDigit, movingWordSpan, swapSpans, moveWordLeftLogic, moveWordRightLogic } from './moveWords';

describe('isLetterOrDigit', () => {
  it('returns true for ASCII letters', () => {
    expect(isLetterOrDigit('a')).toBe(true);
    expect(isLetterOrDigit('Z')).toBe(true);
  });

  it('returns true for digits', () => {
    expect(isLetterOrDigit('0')).toBe(true);
    expect(isLetterOrDigit('9')).toBe(true);
  });

  it('returns false for underscore', () => {
    expect(isLetterOrDigit('_')).toBe(false);
  });

  it('returns false for space', () => {
    expect(isLetterOrDigit(' ')).toBe(false);
  });
});

describe('movingWordSpan', () => {
  it('expands a collapsed caret inside a word to the whole word', () => {
    const { start, end } = movingWordSpan('foo bar', 1, 1);
    expect(start).toBe(0);
    expect(end).toBe(3);
  });
});

describe('swapSpans', () => {
  it('swaps two non-adjacent spans preserving the middle', () => {
    // "foo  bar" — swap [0,3) "foo" with [5,8) "bar", middle "  "
    const r = swapSpans('foo  bar', 0, 3, 5, 8, 0, 3, 5);
    expect(r.text).toBe('bar  foo');
    expect(r.from).toBe(0);
    expect(r.to).toBe(8);
  });
});

describe('moveWordRightLogic', () => {
  it('swaps the current word with the next word', () => {
    const r = moveWordRightLogic('foo bar', 1, 1);
    expect(r.changed).toBe(true);
    const doc = 'foo bar'.slice(0, r.from) + r.text + 'foo bar'.slice(r.to);
    expect(doc).toBe('bar foo');
  });

  it('keeps the separator between the two words', () => {
    const r = moveWordRightLogic('one  two', 0, 0);
    expect(r.changed).toBe(true);
    const doc = 'one  two'.slice(0, r.from) + r.text + 'one  two'.slice(r.to);
    expect(doc).toBe('two  one');
  });

  it('is a no-op when there is no word to the right', () => {
    const r = moveWordRightLogic('foo', 1, 1);
    expect(r.changed).toBe(false);
  });
});

describe('moveWordLeftLogic', () => {
  it('swaps the current word with the previous word', () => {
    const r = moveWordLeftLogic('foo bar', 5, 5);
    expect(r.changed).toBe(true);
    const doc = 'foo bar'.slice(0, r.from) + r.text + 'foo bar'.slice(r.to);
    expect(doc).toBe('bar foo');
  });

  it('is a no-op when the caret is at the start of the document', () => {
    const r = moveWordLeftLogic('foo bar', 0, 0);
    expect(r.changed).toBe(false);
  });
});
