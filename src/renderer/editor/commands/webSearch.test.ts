import { describe, it, expect, vi, afterEach } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { webSearchSelection } from './webSearch';
import { mountView } from './testUtils';

/**
 * Web search (Ctrl+E) parity. No-op on empty selection; trims; caps at 2000
 * chars; hands the query to MAIN via window.notepads.shell.webSearch (renderer
 * NEVER builds the URL — PA-8).
 */

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).notepads;
});

function stubBridge(): ReturnType<typeof vi.fn> {
  const webSearch = vi.fn().mockResolvedValue({ ok: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).notepads = { shell: { webSearch } };
  return webSearch;
}

describe('webSearchSelection', () => {
  it('is a no-op (returns false) with an empty selection', () => {
    const spy = stubBridge();
    const v = mountView('hello', EditorSelection.cursor(0));
    try {
      expect(webSearchSelection(v)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      v.destroy();
    }
  });

  it('hands the trimmed selection to the bridge', () => {
    const spy = stubBridge();
    const v = mountView('  query  ', EditorSelection.range(0, 9));
    try {
      expect(webSearchSelection(v)).toBe(true);
      expect(spy).toHaveBeenCalledWith('query');
    } finally {
      v.destroy();
    }
  });

  it('is a no-op when the selection is all whitespace', () => {
    const spy = stubBridge();
    const v = mountView('     ', EditorSelection.range(0, 5));
    try {
      expect(webSearchSelection(v)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      v.destroy();
    }
  });

  it('caps the query at 2000 characters', () => {
    const spy = stubBridge();
    const big = 'a'.repeat(2500);
    const v = mountView(big, EditorSelection.range(0, 2500));
    try {
      expect(webSearchSelection(v)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as string).length).toBe(2000);
    } finally {
      v.destroy();
    }
  });
});
