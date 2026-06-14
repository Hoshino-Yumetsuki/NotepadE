import { describe, it, expect } from 'vitest';
import { duplicateLogic } from './duplicate';

describe('duplicateLogic (collapsed caret → duplicate line below)', () => {
  it('duplicates the whole line below when the caret is collapsed', () => {
    const r = duplicateLogic('abc\ndef', 2, 2);
    // "abc" line ends at offset 3; insert "\nabc" there → "abc\nabc\ndef"
    expect(r.insertAt).toBe(3);
    expect(r.insert).toBe('\nabc');
    // caret on duplicated line at same column 2 → offset 4 + 2 = 6
    expect(r.newSel.anchor).toBe(6);
    expect(r.newSel.head).toBe(6);
  });

  it('keeps the caret column on the copy for a single-line doc', () => {
    const r = duplicateLogic('hello', 0, 0);
    expect(r.insertAt).toBe(5);
    expect(r.insert).toBe('\nhello');
    expect(r.newSel.head).toBe(6); // 5 + 1 + 0
  });
});

describe('duplicateLogic (non-empty selection → duplicate selected text)', () => {
  it('duplicates the selected text after the selection and selects the copy', () => {
    const r = duplicateLogic('abcd', 1, 3);
    expect(r.insertAt).toBe(3);
    expect(r.insert).toBe('bc');
    expect(r.newSel.anchor).toBe(3);
    expect(r.newSel.head).toBe(5);
  });

  it('repeated duplicate keeps extending', () => {
    // First duplicate: "xy" selected (0..2)
    const r1 = duplicateLogic('xy', 0, 2);
    // doc becomes "xyxy", new sel 2..4
    const doc2 = 'xy' + r1.insert; // "xyxy"
    const r2 = duplicateLogic(doc2, r1.newSel.anchor, r1.newSel.head);
    const doc3 = doc2.slice(0, r2.insertAt) + r2.insert + doc2.slice(r2.insertAt);
    expect(doc3).toBe('xyxyxy');
  });
});
