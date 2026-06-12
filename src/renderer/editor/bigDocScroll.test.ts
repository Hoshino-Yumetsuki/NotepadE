import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { StateEffect } from '@codemirror/state';
import { bigDocScrollStabilizer, BIG_DOC_LINE_THRESHOLD } from './bigDocScroll';

/** Build a state with the stabilizer mounted over a doc of `lines` lines. */
function stateWith(lines: number): EditorState {
  // One char per line keeps the doc cheap; the filter gates on doc.lines.
  const doc = lines <= 1 ? '' : Array.from({ length: lines }, () => 'x').join('\n');
  return EditorState.create({ doc, extensions: [bigDocScrollStabilizer] });
}

/**
 * The stabilizer appends exactly one StateEffect (a cursor scrollIntoView) when
 * it fires, and none otherwise. None of these test transactions sets any other
 * effect, so a non-empty effects array means the stabilizer anchored the edit.
 */
function hasScroll(tr: { effects: readonly StateEffect<unknown>[] }): boolean {
  return tr.effects.length > 0;
}

describe('bigDocScrollStabilizer', () => {
  it('exposes a threshold below the ~410k-line BigScaler onset', () => {
    expect(BIG_DOC_LINE_THRESHOLD).toBeGreaterThan(1000);
    expect(BIG_DOC_LINE_THRESHOLD).toBeLessThan(410_000);
  });

  it('does NOT add a scroll target for a small-doc user edit', () => {
    const state = stateWith(10);
    const tr = state.update({
      changes: { from: 0, insert: 'hello' },
      selection: { anchor: 5 },
      userEvent: 'input.type'
    });
    expect(hasScroll(tr)).toBe(false);
  });

  it('adds a cursor scroll target for a large-doc user input edit', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    // Insert in the MIDDLE of the doc (the failing scenario).
    const mid = Math.floor(state.doc.length / 2);
    const tr = state.update({
      changes: { from: mid, insert: 'Z' },
      selection: { anchor: mid + 1 },
      userEvent: 'input.type'
    });
    expect(hasScroll(tr)).toBe(true);
  });

  it('adds a target for a large-doc delete and move too', () => {
    const big = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const mid = Math.floor(big.doc.length / 2);
    const del = big.update({
      changes: { from: mid, to: mid + 1 },
      selection: { anchor: mid },
      userEvent: 'delete.backward'
    });
    expect(hasScroll(del)).toBe(true);
    const mv = big.update({
      changes: { from: mid, insert: 'q' },
      selection: { anchor: mid + 1 },
      userEvent: 'move.line'
    });
    expect(hasScroll(mv)).toBe(true);
  });

  it('does NOT touch a programmatic (non-user) large-doc edit', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    // No userEvent → an authoritative setDoc-style replacement.
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'replaced\ntext' }
    });
    expect(hasScroll(tr)).toBe(false);
  });

  it('does NOT add a target when the edit already requests scroll (command path)', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const mid = Math.floor(state.doc.length / 2);
    const tr = state.update({
      changes: { from: mid, insert: 'Z' },
      selection: { anchor: mid + 1 },
      userEvent: 'input.type',
      // A command (e.g. Enter / duplicate / indent) sets the scrollIntoView flag.
      scrollIntoView: true
    });
    // The command's own scroll stands; we don't append a second effect.
    expect(hasScroll(tr)).toBe(false);
    expect(tr.scrollIntoView).toBe(true);
  });

  it('selection mapping leaves the appended target on the post-edit caret', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const mid = Math.floor(state.doc.length / 2);
    const tr = state.update({
      changes: { from: mid, insert: 'ABC' },
      selection: { anchor: mid + 3 },
      userEvent: 'input.type'
    });
    expect(hasScroll(tr)).toBe(true);
    // The caret advanced past the inserted text; the doc grew by 3.
    expect(tr.newSelection.main.head).toBe(mid + 3);
    expect(tr.newDoc.length).toBe(state.doc.length + 3);
  });
});
