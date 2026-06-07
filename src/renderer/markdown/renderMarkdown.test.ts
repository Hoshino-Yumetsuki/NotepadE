/**
 * Markdown render parity (UWP MarkdownExtensionView / MarkdownTextBlock) PLUS the
 * mdit-plugins extension surface. Asserts the GFM-equivalent base (headings,
 * emphasis, lists, code, autolink, soft breaks) and the plugin features (task
 * lists, footnotes, sub/sup, marks, inserts, alerts, emoji, …).
 *
 * NOTE: `renderMarkdown` now runs with html:true, so its output is UNTRUSTED raw
 * HTML — the XSS gate moved to sanitizeHtml.ts (see sanitizeHtml.test.ts). These
 * tests therefore assert the RAW render shape; they no longer assert escaping.
 */

import { describe, it, expect } from 'vitest';
import { renderMarkdown, isMarkdownPath } from './renderMarkdown';

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

  it('passes raw HTML through (html:true — sanitization happens downstream)', () => {
    // With html:true the parser no longer escapes; sanitizeMarkdownHtml is the
    // gate that removes dangerous markup (asserted in sanitizeHtml.test.ts).
    const html = renderMarkdown('a <b>bold</b> tag');
    expect(html).toContain('<b>bold</b>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toContain('<blockquote>');
  });

  it('returns an empty-ish string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('renderMarkdown — mdit-plugins extensions', () => {
  it('renders task lists with checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('task-list-item');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('renders footnotes', () => {
    const html = renderMarkdown('text[^1]\n\n[^1]: note');
    expect(html).toContain('footnote-ref');
    expect(html).toContain('class="footnotes"');
  });

  it('renders subscript and superscript', () => {
    expect(renderMarkdown('H~2~O')).toContain('<sub>2</sub>');
    expect(renderMarkdown('x^2^')).toContain('<sup>2</sup>');
  });

  it('renders ==mark== and ++ins++', () => {
    expect(renderMarkdown('==hi==')).toContain('<mark>hi</mark>');
    expect(renderMarkdown('++new++')).toContain('<ins>new</ins>');
  });

  it('renders GitHub-style alert blocks', () => {
    const html = renderMarkdown('> [!NOTE]\n> hello');
    expect(html).toContain('markdown-alert');
    expect(html).toContain('markdown-alert-note');
  });

  it('renders !!spoiler!! spans', () => {
    expect(renderMarkdown('a !!secret!! b')).toContain('class="spoiler"');
  });

  it('renders emoji shortcodes', () => {
    expect(renderMarkdown(':tada:')).toContain('🎉');
  });

  it('renders figures with captions from images', () => {
    const html = renderMarkdown('![cap](https://x.test/a.png)');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>cap</figcaption>');
  });
});
