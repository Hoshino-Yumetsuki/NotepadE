import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { setLtr, setRtl, directionCompartment, directionExtension } from './direction';
import { mountView } from './testUtils';

/**
 * Direction parity (Ctrl+L / Ctrl+R). Flips the content `dir` attribute and the
 * CM6-derived textDirection on the live view.
 */

describe('direction commands', () => {
  function view(initial: 'ltr' | 'rtl') {
    return mountView('hello', EditorSelection.cursor(0), [
      directionCompartment.of(directionExtension(initial)),
    ]);
  }

  it('setRtl sets the content dir attribute to rtl', () => {
    const v = view('ltr');
    try {
      expect(v.contentDOM.getAttribute('dir')).toBe('ltr');
      setRtl(v);
      expect(v.contentDOM.getAttribute('dir')).toBe('rtl');
    } finally {
      v.destroy();
    }
  });

  it('setLtr sets the content dir attribute back to ltr', () => {
    const v = view('rtl');
    try {
      expect(v.contentDOM.getAttribute('dir')).toBe('rtl');
      setLtr(v);
      expect(v.contentDOM.getAttribute('dir')).toBe('ltr');
    } finally {
      v.destroy();
    }
  });

  it('returns true (command handled)', () => {
    const v = view('ltr');
    try {
      expect(setRtl(v)).toBe(true);
      expect(setLtr(v)).toBe(true);
    } finally {
      v.destroy();
    }
  });
});
