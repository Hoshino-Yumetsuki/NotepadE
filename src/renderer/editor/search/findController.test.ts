import { describe, expect, it, vi } from 'vitest';
import { refreshHighlights } from './findController';

const query = { query: '', matchCase: false, wholeWord: false, useRegex: false };

describe('large-file find loading safety', () => {
  it('clears an empty query without materializing a Piece Tree model', () => {
    const model = {
      _isTooLargeForTokenization: true,
      getValue: vi.fn(() => {
        throw new Error('full-document materialization');
      })
    };
    const editor = {
      getModel: () => model,
      deltaDecorations: vi.fn((_old: string[], _next: unknown[]) => [])
    };

    refreshHighlights(editor as never, query);

    expect(model.getValue).not.toHaveBeenCalled();
    expect(editor.deltaDecorations).toHaveBeenCalledWith([], []);
  });

  it('uses Monaco search instead of getValue for a non-empty query', () => {
    const model = {
      _isTooLargeForTokenization: true,
      getValue: vi.fn(() => {
        throw new Error('full-document materialization');
      }),
      findMatches: vi.fn(() => [
        { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 } }
      ]),
      getOffsetAt: vi.fn(({ column }: { column: number }) => column - 1),
      getPositionAt: vi.fn((offset: number) => ({ lineNumber: 1, column: offset + 1 }))
    };
    const editor = {
      getModel: () => model,
      getOption: vi.fn(() => ''),
      deltaDecorations: vi.fn((_old: string[], _next: unknown[]) => [])
    };

    refreshHighlights(editor as never, {
      query: 'needle',
      matchCase: false,
      wholeWord: false,
      useRegex: false
    });

    expect(model.findMatches).toHaveBeenCalledOnce();
    expect(model.getValue).not.toHaveBeenCalled();
  });
});
