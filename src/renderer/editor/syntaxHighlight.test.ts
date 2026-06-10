import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  matchLanguage,
  shouldHighlight,
  highlightStyleFor,
  MAX_HIGHLIGHT_DOC_LENGTH
} from './syntaxHighlight';

describe('syntaxHighlight — extension → language matching', () => {
  it('matches common code extensions to their language', () => {
    expect(matchLanguage('C:\\code\\app.js')?.name).toBe('JavaScript');
    expect(matchLanguage('/home/u/data.json')?.name).toBe('JSON');
    expect(matchLanguage('page.html')?.name).toBe('HTML');
    expect(matchLanguage('style.css')?.name).toBe('CSS');
    expect(matchLanguage('script.py')?.name).toBe('Python');
    expect(matchLanguage('README.md')?.name).toBe('Markdown');
    expect(matchLanguage('main.cpp')?.name).toBe('C++');
    expect(matchLanguage('Main.java')?.name).toBe('Java');
    expect(matchLanguage('app.tsx')?.name).toBe('TSX');
    expect(matchLanguage('config.xml')?.name).toBe('XML');
  });

  it('matches on the basename only (directories with dots do not confuse it)', () => {
    expect(matchLanguage('C:\\my.folder.js\\notes.py')?.name).toBe('Python');
    expect(matchLanguage('/etc/app.d/file.css')?.name).toBe('CSS');
  });

  it('returns null for plain text, unknown extensions, and untitled docs (Notepad parity)', () => {
    expect(matchLanguage('notes.txt')).toBeNull();
    expect(matchLanguage('readme.unknownext')).toBeNull();
    expect(matchLanguage('extensionless')).toBeNull();
    expect(matchLanguage(null)).toBeNull();
    expect(matchLanguage(undefined)).toBeNull();
    expect(matchLanguage('')).toBeNull();
  });
});

describe('syntaxHighlight — shouldHighlight gate', () => {
  it('allows recognized extensions under the size threshold', () => {
    expect(shouldHighlight('app.js', 1000)).toBe(true);
    expect(shouldHighlight('app.js', MAX_HIGHLIGHT_DOC_LENGTH)).toBe(true);
  });

  it('gates OFF above the large-doc threshold even for recognized extensions', () => {
    expect(shouldHighlight('app.js', MAX_HIGHLIGHT_DOC_LENGTH + 1)).toBe(false);
  });

  it('stays off for .txt and untitled regardless of size', () => {
    expect(shouldHighlight('notes.txt', 10)).toBe(false);
    expect(shouldHighlight(null, 10)).toBe(false);
  });
});

describe('syntaxHighlight — theme-matched style', () => {
  it('produces a mountable extension for light and dark, and nothing for HC', () => {
    // Mountability is the contract: EditorState.create throws on bad extensions.
    for (const mode of ['light', 'dark'] as const) {
      const state = EditorState.create({ doc: 'x', extensions: [highlightStyleFor(mode)] });
      expect(state).toBeTruthy();
    }
    expect(highlightStyleFor('hc')).toEqual([]);
  });
});

describe('syntaxHighlight — a matched language actually parses (lazy load)', () => {
  it('JSON loads and produces a non-trivial syntax tree', async () => {
    const desc = matchLanguage('data.json');
    expect(desc).not.toBeNull();
    const support = await desc!.load();
    const state = EditorState.create({
      doc: '{"a": [1, true, "s"]}',
      extensions: [support, highlightStyleFor('light')]
    });
    const tree = syntaxTree(state);
    // A real parser yields a typed tree with children, not a single flat node.
    expect(tree.type.name).not.toBe('');
    let nodes = 0;
    tree.iterate({
      enter: () => {
        nodes++;
      }
    });
    expect(nodes).toBeGreaterThan(5);
  });
});
