import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { toggleWordWrap, wordWrapField, wordWrapCompartment, wordWrapExtension } from './wordWrap';
import { mountView } from './testUtils';

/**
 * Word-wrap parity (Alt+Z). Toggles the wordWrapField boolean and reconfigures
 * the lineWrapping compartment on the live view.
 */

describe('toggleWordWrap', () => {
  function view(initial: boolean) {
    return mountView('a long line of text', EditorSelection.cursor(0), [
      wordWrapField.init(() => initial),
      wordWrapCompartment.of(wordWrapExtension(initial)),
    ]);
  }

  it('turns wrap ON from the default OFF state', () => {
    const v = view(false);
    try {
      expect(v.state.field(wordWrapField)).toBe(false);
      toggleWordWrap(v);
      expect(v.state.field(wordWrapField)).toBe(true);
    } finally {
      v.destroy();
    }
  });

  it('turns wrap OFF again on a second toggle', () => {
    const v = view(false);
    try {
      toggleWordWrap(v);
      toggleWordWrap(v);
      expect(v.state.field(wordWrapField)).toBe(false);
    } finally {
      v.destroy();
    }
  });

  it('returns true (command handled)', () => {
    const v = view(false);
    try {
      expect(toggleWordWrap(v)).toBe(true);
    } finally {
      v.destroy();
    }
  });
});
