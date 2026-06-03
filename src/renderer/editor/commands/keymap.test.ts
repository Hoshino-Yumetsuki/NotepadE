import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { history, redoDepth, undoDepth } from '@codemirror/commands';
import { undoRedoExtension } from './keymap';
import { mountView } from './testUtils';

/**
 * Cross-platform undo/redo (Gate-3 bug). For a Ctrl+CHAR event CM6 strips Shift
 * on its first lookup, so plain 'Ctrl-z'→undo fires before any 'Shift-Ctrl-z'
 * slot — a Mod-Shift-z BINDING can never win. We route undo/redo through a
 * single `any` handler (undoRedoExtension) that reads the raw event.shiftKey.
 *
 * These tests dispatch real KeyboardEvents at the view's contentDOM so the CM6
 * keymap pipeline (and the shift-strip) is exercised end-to-end.
 */

/** Press Ctrl+<key> (optionally with Shift) at the editor's content DOM. */
function press(view: { contentDOM: HTMLElement }, key: string, shift = false): void {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
}

describe('undoRedoExtension', () => {
  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes (shift not stripped)', () => {
    const view = mountView('', EditorSelection.cursor(0), [history(), undoRedoExtension]);
    try {
      view.dispatch(
        view.state.update({ changes: { from: 0, insert: 'abc' }, userEvent: 'input.type' }),
      );
      expect(view.state.doc.toString()).toBe('abc');

      press(view, 'z'); // Ctrl+Z
      expect(view.state.doc.toString()).toBe('');
      expect(redoDepth(view.state)).toBe(1);

      press(view, 'z', true); // Ctrl+Shift+Z — must REDO, not a second undo
      expect(view.state.doc.toString()).toBe('abc');
      expect(undoDepth(view.state)).toBe(1);
      expect(redoDepth(view.state)).toBe(0);
    } finally {
      view.destroy();
    }
  });

  it('Ctrl+Y also redoes (Windows / UWP parity)', () => {
    const view = mountView('', EditorSelection.cursor(0), [history(), undoRedoExtension]);
    try {
      view.dispatch(
        view.state.update({ changes: { from: 0, insert: 'xy' }, userEvent: 'input.type' }),
      );
      press(view, 'z'); // undo
      expect(view.state.doc.toString()).toBe('');
      press(view, 'y'); // Ctrl+Y redo
      expect(view.state.doc.toString()).toBe('xy');
    } finally {
      view.destroy();
    }
  });

  it('ignores Ctrl+Alt+Z (no undo/redo when Alt is held)', () => {
    const view = mountView('', EditorSelection.cursor(0), [history(), undoRedoExtension]);
    try {
      view.dispatch(
        view.state.update({ changes: { from: 0, insert: 'q' }, userEvent: 'input.type' }),
      );
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      // Alt held → handler returns false, doc unchanged by the redo/undo path.
      expect(view.state.doc.toString()).toBe('q');
    } finally {
      view.destroy();
    }
  });
});
