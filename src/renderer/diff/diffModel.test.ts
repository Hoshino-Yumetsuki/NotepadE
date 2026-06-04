import { describe, it, expect } from 'vitest';
import { buildDiffModel, type DiffModel } from './diffModel';

/**
 * Side-by-side diff MODEL parity (UWP RichTextBlockDiffRenderer). Asserts the
 * row-alignment invariant (both columns always equal length), per-row kinds
 * (unchanged / inserted / deleted / modified / imaginary), the replace-block
 * pairing, and the character-level sub-pieces on modified rows. Pure logic — no
 * DOM, no IPC.
 */

/** Both columns must always have the same number of rows (synced-scroll invariant). */
function expectAligned(model: DiffModel): void {
  expect(model.left.length).toBe(model.right.length);
}

describe('buildDiffModel', () => {
  it('identical text → all unchanged, no fillers', () => {
    const m = buildDiffModel('a\nb\nc', 'a\nb\nc');
    expectAligned(m);
    expect(m.left.map((r) => r.kind)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(m.right.map((r) => r.kind)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(m.left.map((r) => r.text)).toEqual(['a', 'b', 'c']);
  });

  it('empty vs empty → empty aligned columns', () => {
    const m = buildDiffModel('', '');
    expectAligned(m);
    // jsdiff yields no hunks for two empty strings.
    expect(m.left).toEqual([]);
    expect(m.right).toEqual([]);
  });

  it('pure insertion → left filler (imaginary), right inserted', () => {
    const m = buildDiffModel('a\nc', 'a\nb\nc');
    expectAligned(m);
    const rightKinds = m.right.map((r) => r.kind);
    const leftKinds = m.left.map((r) => r.kind);
    expect(rightKinds).toContain('inserted');
    // The inserted row pairs against an imaginary filler on the left.
    const insertedIdx = rightKinds.indexOf('inserted');
    expect(leftKinds[insertedIdx]).toBe('imaginary');
    expect(m.right[insertedIdx].text).toBe('b');
    expect(m.left[insertedIdx].text).toBe('');
  });

  it('pure deletion → left deleted, right filler (imaginary)', () => {
    const m = buildDiffModel('a\nb\nc', 'a\nc');
    expectAligned(m);
    const leftKinds = m.left.map((r) => r.kind);
    const deletedIdx = leftKinds.indexOf('deleted');
    expect(deletedIdx).toBeGreaterThanOrEqual(0);
    expect(m.left[deletedIdx].text).toBe('b');
    expect(m.right[deletedIdx].kind).toBe('imaginary');
  });

  it('replaced line → modified rows on both columns with char-level pieces', () => {
    const m = buildDiffModel('hello world', 'hello there');
    expectAligned(m);
    expect(m.left[0].kind).toBe('modified');
    expect(m.right[0].kind).toBe('modified');
    // Left keeps unchanged + deleted spans; right keeps unchanged + inserted.
    const leftKinds = new Set(m.left[0].pieces!.map((p) => p.kind));
    const rightKinds = new Set(m.right[0].pieces!.map((p) => p.kind));
    expect(leftKinds.has('deleted')).toBe(true);
    expect(rightKinds.has('inserted')).toBe(true);
    // The shared prefix "hello " stays unchanged in both.
    expect(m.left[0].pieces![0]).toEqual({ text: 'hello ', kind: 'unchanged' });
    expect(m.right[0].pieces![0]).toEqual({ text: 'hello ', kind: 'unchanged' });
    // Reassembling each column's pieces reproduces the line text.
    expect(m.left[0].pieces!.map((p) => p.text).join('')).toBe('hello world');
    expect(m.right[0].pieces!.map((p) => p.text).join('')).toBe('hello there');
  });

  it('replace block with ragged tail → modified pairs then filler', () => {
    // 2 old lines replaced by 3 new lines: 2 modified pairs + 1 inserted/filler.
    const m = buildDiffModel('a1\na2', 'b1\nb2\nb3');
    expectAligned(m);
    expect(m.left.map((r) => r.kind)).toEqual(['modified', 'modified', 'imaginary']);
    expect(m.right.map((r) => r.kind)).toEqual(['modified', 'modified', 'inserted']);
    expect(m.right[2].text).toBe('b3');
  });

  it('replace block, more deletions than insertions → modified then deleted/filler', () => {
    const m = buildDiffModel('a1\na2\na3', 'b1');
    expectAligned(m);
    expect(m.left.map((r) => r.kind)).toEqual(['modified', 'deleted', 'deleted']);
    expect(m.right.map((r) => r.kind)).toEqual(['modified', 'imaginary', 'imaginary']);
  });

  it('imaginary filler rows carry no text', () => {
    const m = buildDiffModel('a', 'a\nb');
    for (const row of [...m.left, ...m.right]) {
      if (row.kind === 'imaginary') expect(row.text).toBe('');
    }
  });

  it('CRLF-free shadow buffers only: trailing newline does not create a phantom row', () => {
    // Shadow buffer convention: lines are '\n'-separated; a trailing '\n' is a
    // terminator, not an extra empty line.
    const m = buildDiffModel('a\nb\n', 'a\nb\n');
    expectAligned(m);
    expect(m.left.map((r) => r.text)).toEqual(['a', 'b']);
  });
});
