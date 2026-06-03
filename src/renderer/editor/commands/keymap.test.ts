import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { history, redoDepth } from '@codemirror/commands';
import { undoRedoKeymap } from './keymap';
import { mountView } from './testUtils';

/**
 * Cross-platform undo/redo binding (Gate-3 bug). CM6's stock historyKeymap only
 * binds Ctrl+Shift+Z redo on linux/mac — never on Electron-Windows — so the
 * chord fell through to a second undo. We bind Mod-Shift-z (+Mod-y) redo and
 * Mod-z undo at the HIGHEST precedence, platform-unconditionally.
 */

describe('undoRedoKeymap', () => {
  it('binds Mod-z (undo), Mod-Shift-z (redo) and Mod-y (redo) with no platform qualifier', () => {
    const keys = undoRedoKeymap.map((b) => b.key);
    expect(keys).toEqual(['Mod-z', 'Mod-Shift-z', 'Mod-y']);
    for (const b of undoRedoKeymap) {
      // No mac:/linux:/win: qualifier — the binding fires on every platform.
      expect(b.mac).toBeUndefined();
      expect(b.linux).toBeUndefined();
      expect(b.win).toBeUndefined();
      expect(b.preventDefault).toBe(true);
    }
  });

  it('Mod-Shift-z redo restores an undone edit (with Mod-z undo)', () => {
    const view = mountView('', EditorSelection.cursor(0), [history()]);
    try {
      view.dispatch(
        view.state.update({ changes: { from: 0, insert: 'abc' }, userEvent: 'input.type' }),
      );
      expect(view.state.doc.toString()).toBe('abc');

      const undoBinding = undoRedoKeymap.find((b) => b.key === 'Mod-z');
      const redoBinding = undoRedoKeymap.find((b) => b.key === 'Mod-Shift-z');
      expect(undoBinding?.run).toBeTypeOf('function');
      expect(redoBinding?.run).toBeTypeOf('function');

      undoBinding!.run!(view);
      expect(view.state.doc.toString()).toBe('');
      expect(redoDepth(view.state)).toBeGreaterThan(0);

      redoBinding!.run!(view);
      expect(view.state.doc.toString()).toBe('abc');
    } finally {
      view.destroy();
    }
  });

  it('Mod-y also redoes (Windows Ctrl+Y / UWP parity)', () => {
    const view = mountView('', EditorSelection.cursor(0), [history()]);
    try {
      view.dispatch(
        view.state.update({ changes: { from: 0, insert: 'xy' }, userEvent: 'input.type' }),
      );
      undoRedoKeymap.find((b) => b.key === 'Mod-z')!.run!(view);
      expect(view.state.doc.toString()).toBe('');
      undoRedoKeymap.find((b) => b.key === 'Mod-y')!.run!(view);
      expect(view.state.doc.toString()).toBe('xy');
    } finally {
      view.destroy();
    }
  });
});
