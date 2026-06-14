import { describe, it, expect } from 'vitest';
import { moveLinesLogic } from './moveLines';

describe('moveLinesLogic — up', () => {
  it('swaps the current line with the one above', () => {
    const r = moveLinesLogic('a\nb\nc', 2, 2, 2, 2, 'up');
    expect(r.changed).toBe(true);
    const doc = 'a\nb\nc'.slice(0, r.from) + r.insert + 'a\nb\nc'.slice(r.to);
    expect(doc).toBe('b\na\nc');
  });

  it('is a no-op when the first spanned line is line 1', () => {
    const r = moveLinesLogic('a\nb\nc', 0, 0, 0, 0, 'up');
    expect(r.changed).toBe(false);
  });

  it('moves a multi-line block up together', () => {
    // select lines 2-3 ("b","c"): offsets 2..5
    const r = moveLinesLogic('a\nb\nc', 2, 5, 2, 5, 'up');
    expect(r.changed).toBe(true);
    const doc = 'a\nb\nc'.slice(0, r.from) + r.insert + 'a\nb\nc'.slice(r.to);
    expect(doc).toBe('b\nc\na');
  });
});

describe('moveLinesLogic — down', () => {
  it('swaps the current line with the one below', () => {
    const r = moveLinesLogic('a\nb\nc', 0, 0, 0, 0, 'down');
    expect(r.changed).toBe(true);
    const doc = 'a\nb\nc'.slice(0, r.from) + r.insert + 'a\nb\nc'.slice(r.to);
    expect(doc).toBe('b\na\nc');
  });

  it('is a no-op when the last spanned line is the final line', () => {
    const r = moveLinesLogic('a\nb\nc', 4, 4, 4, 4, 'down');
    expect(r.changed).toBe(false);
  });

  it('moves a multi-line block down together', () => {
    // select lines 1-2 ("a","b"): offsets 0..3
    const r = moveLinesLogic('a\nb\nc', 0, 3, 0, 3, 'down');
    expect(r.changed).toBe(true);
    const doc = 'a\nb\nc'.slice(0, r.from) + r.insert + 'a\nb\nc'.slice(r.to);
    expect(doc).toBe('c\na\nb');
  });
});
