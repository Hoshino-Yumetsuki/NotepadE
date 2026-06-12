import { describe, it, expect } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  BIG_DOC_LINE_THRESHOLD,
  isBigDocUserEdit,
  captureBigDocAnchor,
  bigDocDispatchTransactions
} from './bigDocScroll';

/** Build a state over a doc of `lines` one-char lines. */
function stateWith(lines: number): EditorState {
  const doc = lines <= 1 ? '' : Array.from({ length: lines }, () => 'x').join('\n');
  return EditorState.create({ doc });
}

/** A mid-document user 'input.type' insert transaction over `state`. */
function midInsert(state: EditorState): Transaction {
  const mid = Math.floor(state.doc.length / 2);
  return state.update({
    changes: { from: mid, insert: 'Z' },
    selection: { anchor: mid + 1 },
    userEvent: 'input.type'
  });
}

describe('isBigDocUserEdit', () => {
  it('exposes a threshold below the ~410k-line BigScaler onset', () => {
    expect(BIG_DOC_LINE_THRESHOLD).toBeGreaterThan(1000);
    expect(BIG_DOC_LINE_THRESHOLD).toBeLessThan(410_000);
  });

  it('is false for a small-doc user edit', () => {
    expect(isBigDocUserEdit([midInsert(stateWith(10))])).toBe(false);
  });

  it('is true for a large-doc user input edit', () => {
    expect(isBigDocUserEdit([midInsert(stateWith(BIG_DOC_LINE_THRESHOLD + 5))])).toBe(true);
  });

  it('is true for large-doc delete and move user events too', () => {
    const big = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const mid = Math.floor(big.doc.length / 2);
    const del = big.update({
      changes: { from: mid, to: mid + 1 },
      selection: { anchor: mid },
      userEvent: 'delete.backward'
    });
    expect(isBigDocUserEdit([del])).toBe(true);
    const mv = big.update({
      changes: { from: mid, insert: 'q' },
      selection: { anchor: mid + 1 },
      userEvent: 'move.line'
    });
    expect(isBigDocUserEdit([mv])).toBe(true);
  });

  it('is false for a programmatic (non-user) large-doc edit', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const tr = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'replaced\ntext' }
    });
    expect(isBigDocUserEdit([tr])).toBe(false);
  });

  it('is false for undo/redo and selection-only transactions', () => {
    const state = stateWith(BIG_DOC_LINE_THRESHOLD + 5);
    const undo = state.update({
      changes: { from: 0, insert: 'u' },
      userEvent: 'undo'
    });
    expect(isBigDocUserEdit([undo])).toBe(false);
    const select = state.update({ selection: { anchor: 3 }, userEvent: 'select' });
    expect(isBigDocUserEdit([select])).toBe(false);
  });
});

describe('captureBigDocAnchor / bigDocDispatchTransactions (jsdom)', () => {
  // jsdom has no layout: scrollDOM.clientHeight is 0, so the anchor must be
  // refused (hidden-editor guard) and dispatch must pass the batch through
  // verbatim. The pixel-anchoring path itself is verified in a real browser
  // (BigScaler + scroll geometry do not exist in jsdom).
  it('returns null when the editor has no laid-out height', () => {
    const view = new EditorView({ state: stateWith(BIG_DOC_LINE_THRESHOLD + 5) });
    try {
      const tr = midInsert(view.state);
      expect(captureBigDocAnchor(view, [tr])).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('returns null for an empty batch', () => {
    const view = new EditorView({ state: stateWith(BIG_DOC_LINE_THRESHOLD + 5) });
    try {
      expect(captureBigDocAnchor(view, [])).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('passes the batch through: the edit is applied verbatim', () => {
    const view = new EditorView({
      state: stateWith(BIG_DOC_LINE_THRESHOLD + 5),
      dispatchTransactions: bigDocDispatchTransactions
    });
    try {
      const before = view.state.doc.length;
      const tr = midInsert(view.state);
      view.dispatch(tr);
      expect(view.state.doc.length).toBe(before + 1);
      expect(view.state.selection.main.head).toBe(Math.floor(before / 2) + 1);
    } finally {
      view.destroy();
    }
  });
});
