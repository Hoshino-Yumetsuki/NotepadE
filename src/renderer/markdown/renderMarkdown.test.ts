import { describe, it, expect } from 'vitest';
import { renderMarkdown, isMarkdownPath } from './renderMarkdown';

/**
 * Markdown render parity (UWP MarkdownExtensionView / MarkdownTextBlock). Asserts
 * the GFM-equivalent surface: headings, emphasis, lists, code, autolink, soft
 * breaks, and the XSS-safe html:false behavior. Pure text→HTML transform.
 */

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

describe('renderMarkdown', () => {
  it('renders ATX headings', () => {
    expect(renderMarkdown('# Title')).toContain('<h1>Title</h1>');
    expect(renderMarkdown('### Sub')).toContain('<h3>Sub</h3>');
  });

  it('renders emphasis and strong', () => {
    const html = renderMarkdown('*em* and **strong**');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<strong>strong</strong>');
  });

  it('renders bullet and ordered lists', () => {
    const ul = renderMarkdown('- a\n- b');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>a</li>');
    const ol = renderMarkdown('1. one\n2. two');
    expect(ol).toContain('<ol>');
  });

  it('renders inline code and fenced code blocks', () => {
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
    const fenced = renderMarkdown('```\nconst x = 1;\n```');
    expect(fenced).toContain('<pre>');
    expect(fenced).toContain('const x = 1;');
  });

  it('autolinks bare URLs (linkify / GFM autolink parity)', () => {
    const html = renderMarkdown('see https://example.com here');
    expect(html).toContain('href="https://example.com"');
  });

  it('renders explicit markdown links', () => {
    expect(renderMarkdown('[text](https://x.test)')).toContain('href="https://x.test"');
  });

  it('renders a single newline as a soft <br> (breaks:true)', () => {
    expect(renderMarkdown('line one\nline two')).toContain('<br>');
  });

  it('does NOT pass through raw HTML (html:false — XSS-safe)', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    // The angle brackets are escaped into entities instead.
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes inline HTML in user text', () => {
    const html = renderMarkdown('a <b>bold</b> tag');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>');
  });

  it('returns an empty-ish string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
