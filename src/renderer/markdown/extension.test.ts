/**
 * isMarkdownPath tests — ported verbatim from the deleted renderMarkdown.test.ts.
 * The markdown rendering pipeline is now in Rust; only the extension predicate
 * remains on the JS side.
 */

import { describe, it, expect } from 'vitest';
import { isMarkdownPath } from './extension';

describe('isMarkdownPath', () => {
  it('recognizes the .md family case-insensitively', () => {
    expect(isMarkdownPath('notes.md')).toBe(true);
    expect(isMarkdownPath('README.MD')).toBe(true);
    expect(isMarkdownPath('doc.markdown')).toBe(true);
    expect(isMarkdownPath('a.mdown')).toBe(true);
    expect(isMarkdownPath('C:\\x\\y\\file.MkDn')).toBe(true);
  });

  it('rejects non-markdown and untitled buffers', () => {
    expect(isMarkdownPath('script.ts')).toBe(false);
    expect(isMarkdownPath('plain.txt')).toBe(false);
    expect(isMarkdownPath('noext')).toBe(false);
    expect(isMarkdownPath(null)).toBe(false);
  });
});
