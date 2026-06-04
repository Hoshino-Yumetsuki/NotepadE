import { describe, it, expect } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { indentSelection, outdentSelection } from './indent';
import { runStateCommand } from './testUtils';

/**
 * Indent / outdent (Tab / Shift+Tab) parity with tab-as-spaces. Reads the
 * `editorSettings.tabAsSpaces` facet: -1 = real tab, 2|4|8 = that many spaces.
 */

describe('indentSelection', () => {
  it('inserts a real tab at the caret by default (tabAsSpaces = -1)', () => {
    const r = runStateCommand(indentSelection, 'abc', EditorSelection.cursor(0), {
      tabAsSpaces: -1,
    });
    expect(r.doc).toBe('\tabc');
  });

  it('inserts 2 spaces when tabAsSpaces = 2', () => {
    const r = runStateCommand(indentSelection, 'abc', EditorSelection.cursor(0), {
      tabAsSpaces: 2,
    });
    expect(r.doc).toBe('  abc');
  });

  it('inserts 4 spaces when tabAsSpaces = 4', () => {
    const r = runStateCommand(indentSelection, 'abc', EditorSelection.cursor(0), {
      tabAsSpaces: 4,
    });
    expect(r.doc).toBe('    abc');
  });

  it('inserts 8 spaces when tabAsSpaces = 8', () => {
    const r = runStateCommand(indentSelection, 'abc', EditorSelection.cursor(0), {
      tabAsSpaces: 8,
    });
    expect(r.doc).toBe('        abc');
  });

  it('prefixes every spanned line on a multi-line selection (4 spaces)', () => {
    const r = runStateCommand(indentSelection, 'a\nb', EditorSelection.range(0, 3), {
      tabAsSpaces: 4,
    });
    expect(r.doc).toBe('    a\n    b');
  });
});

describe('outdentSelection', () => {
  it('removes one leading real tab', () => {
    const r = runStateCommand(outdentSelection, '\tabc', EditorSelection.cursor(1), {
      tabAsSpaces: -1,
    });
    expect(r.doc).toBe('abc');
    expect(r.changed).toBe(true);
  });

  it('removes 2 leading spaces when tabAsSpaces = 2', () => {
    const r = runStateCommand(outdentSelection, '  abc', EditorSelection.cursor(2), {
      tabAsSpaces: 2,
    });
    expect(r.doc).toBe('abc');
  });

  it('removes 4 leading spaces when tabAsSpaces = 4', () => {
    const r = runStateCommand(outdentSelection, '    abc', EditorSelection.cursor(4), {
      tabAsSpaces: 4,
    });
    expect(r.doc).toBe('abc');
  });

  it('removes 8 leading spaces when tabAsSpaces = 8', () => {
    const r = runStateCommand(outdentSelection, '        abc', EditorSelection.cursor(8), {
      tabAsSpaces: 8,
    });
    expect(r.doc).toBe('abc');
  });

  it('removes only the partial remainder when leading spaces are not a whole multiple', () => {
    // 3 leading spaces, indentAmount 4 → insufficient = 3 % 4 = 3, strip 3.
    const r = runStateCommand(outdentSelection, '   abc', EditorSelection.cursor(3), {
      tabAsSpaces: 4,
    });
    expect(r.doc).toBe('abc');
  });

  it('falls back to 4-space outdent width when tabAsSpaces is real tab', () => {
    const r = runStateCommand(outdentSelection, '      abc', EditorSelection.cursor(6), {
      tabAsSpaces: -1,
    });
    // 6 spaces, indentAmount 4 → insufficient = 6 % 4 = 2, strip 2.
    expect(r.doc).toBe('    abc');
  });

  it('is a no-op when there is no leading whitespace to strip', () => {
    const r = runStateCommand(outdentSelection, 'abc', EditorSelection.cursor(0), {
      tabAsSpaces: 4,
    });
    expect(r.doc).toBe('abc');
    expect(r.changed).toBe(false);
  });
});
