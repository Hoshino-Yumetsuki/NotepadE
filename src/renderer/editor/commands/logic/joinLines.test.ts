import { describe, it, expect } from 'vitest';
import { joinLogic } from './joinLines';

describe('joinLogic', () => {
  it('joins two spanned lines with a single space', () => {
    const r = joinLogic('abc\ndef', 1, 5, 1, 5);
    expect(r.joined).toBe('abc def');
    expect(r.changed).toBe(true);
    expect(r.from).toBe(0);
    expect(r.to).toBe(7);
  });

  it('joins three spanned lines with single spaces', () => {
    const r = joinLogic('a\nb\nc', 0, 5, 0, 5);
    expect(r.joined).toBe('a b c');
    expect(r.changed).toBe(true);
  });

  it('is a no-op when the selection stays within a single line', () => {
    const r = joinLogic('abc\ndef', 0, 2, 0, 2);
    expect(r.changed).toBe(false);
    expect(r.joined).toBe('abc');
  });

  it('is a no-op for a collapsed caret', () => {
    const r = joinLogic('abc\ndef', 1, 1, 1, 1);
    expect(r.changed).toBe(false);
  });

  it('clamps the new selection to the joined length', () => {
    // Joining "abc\ndef" (7 chars) → "abc def" (7 chars).
    // anchor/head beyond end get clamped.
    const r = joinLogic('abc\ndef', 0, 7, 0, 7);
    expect(r.newSel.head).toBeLessThanOrEqual(r.from + r.joined.length);
  });
});
