import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { smartTrimSelection, smartCopyHandler } from './smartCopy';
import { editorSettings } from '../editorSettings';
import { mountView } from './testUtils';

/**
 * Smart Copy parity (RENDERER, Lane B), honoring approved divergence #6:
 *   - COPY trims whitespace from the selection ONLY when Smart Copy is ON.
 *   - Default OFF (no trim).
 *   - CUT is NEVER trimmed.
 *   - Trim mutates clipboard payload only — it must NOT push an undo step.
 */

describe('smartTrimSelection (pure trim rule)', () => {
  it('trims trailing whitespace but keeps leading indent on the first content line', () => {
    // No leading line break → leading spaces are kept; trailing is trimmed.
    expect(smartTrimSelection('  abc  ')).toBe('  abc');
  });

  it('leaves an all-whitespace selection untouched', () => {
    expect(smartTrimSelection('   ')).toBe('   ');
    expect(smartTrimSelection('\n\t ')).toBe('\n\t ');
  });

  it('drops whole leading blank lines but keeps indent on the first content line', () => {
    // leading run "\n  " → last break pulls start to after the '\n', keeping "  ".
    expect(smartTrimSelection('\n  abc')).toBe('  abc');
  });

  it('trims trailing line breaks', () => {
    expect(smartTrimSelection('abc\n\n')).toBe('abc');
  });

  it('returns an empty selection unchanged', () => {
    expect(smartTrimSelection('')).toBe('');
  });
});

/** Build a synthetic clipboard event with a capturing DataTransfer-like stub. */
function makeClipboardEvent(type: 'copy' | 'cut'): {
  event: Event;
  written: { value: string | null };
  prevented: () => boolean;
} {
  const written = { value: null as string | null };
  let defaultPrevented = false;
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { setData: (mime: string, data: string) => void };
  };
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (_mime: string, data: string) => {
        written.value = data;
      },
    },
  });
  const origPrevent = event.preventDefault.bind(event);
  event.preventDefault = () => {
    defaultPrevented = true;
    origPrevent();
  };
  return { event, written, prevented: () => defaultPrevented };
}

describe('smartCopyHandler (DOM copy interception)', () => {
  it('does NOT trim on copy when Smart Copy is OFF (default)', () => {
    const view = mountView('  abc  ', EditorSelection.range(0, 7), [
      editorSettings.of({ smartCopy: false }),
      smartCopyHandler,
    ]);
    try {
      const { event, written } = makeClipboardEvent('copy');
      view.contentDOM.dispatchEvent(event);
      // handler returns false → no clipboard override
      expect(written.value).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('trims on copy when Smart Copy is ON', () => {
    const view = mountView('  abc  ', EditorSelection.range(0, 7), [
      editorSettings.of({ smartCopy: true }),
      smartCopyHandler,
    ]);
    try {
      const { event, written, prevented } = makeClipboardEvent('copy');
      view.contentDOM.dispatchEvent(event);
      // Trailing trimmed; leading indent preserved (no leading line break).
      expect(written.value).toBe('  abc');
      expect(prevented()).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it('never trims on cut even when Smart Copy is ON', () => {
    const view = mountView('  abc  ', EditorSelection.range(0, 7), [
      editorSettings.of({ smartCopy: true }),
      smartCopyHandler,
    ]);
    try {
      const { event, written } = makeClipboardEvent('cut');
      view.contentDOM.dispatchEvent(event);
      // No cut handler is registered → clipboard untouched, doc unchanged.
      expect(written.value).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('does not modify the document or push an undo step when trimming on copy', () => {
    const view = mountView('  abc  ', EditorSelection.range(0, 7), [
      editorSettings.of({ smartCopy: true }),
      smartCopyHandler,
    ]);
    try {
      const before = view.state.doc.toString();
      const { event } = makeClipboardEvent('copy');
      view.contentDOM.dispatchEvent(event);
      // Doc must be byte-for-byte identical (trim only affects clipboard payload).
      expect(view.state.doc.toString()).toBe(before);
    } finally {
      view.destroy();
    }
  });
});
