/**
 * Sanitization gate tests (Lane B). `renderMarkdown` runs html:true, so its output
 * is untrusted; `sanitizeMarkdownHtml` is the mandatory pass that makes it safe to
 * inject. These tests assert the XSS gate (scripts/handlers/javascript: dropped)
 * and the image-source policy (https/data:image kept, everything else dropped).
 */

import { describe, it, expect } from 'vitest';
import { sanitizeMarkdownHtml, isAllowedImageSrc } from './sanitizeHtml';

describe('sanitizeMarkdownHtml — XSS gate', () => {
  it('strips <script> tags', () => {
    const out = sanitizeMarkdownHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeMarkdownHtml('<img src="https://x.test/a.png" onerror="alert(1)">');
    expect(out).not.toContain('onerror');
  });

  it('drops javascript: links', () => {
    const out = sanitizeMarkdownHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('keeps safe structural markup the plugins emit', () => {
    const out = sanitizeMarkdownHtml(
      '<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p></div>',
    );
    expect(out).toContain('markdown-alert-note');
    expect(out).toContain('markdown-alert-title');
  });

  it('keeps task-list checkboxes (input allow-listed)', () => {
    const out = sanitizeMarkdownHtml(
      '<input type="checkbox" class="task-list-item-checkbox" checked>',
    );
    expect(out).toContain('type="checkbox"');
  });

  it('keeps the align plugin style attribute (CSS-sanitized)', () => {
    const out = sanitizeMarkdownHtml('<div style="text-align:center">hi</div>');
    expect(out).toContain('text-align');
  });

  it('adds rel/target hardening to external links', () => {
    const out = sanitizeMarkdownHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe('isAllowedImageSrc — image-source policy', () => {
  it('allows https images with an image extension', () => {
    expect(isAllowedImageSrc('https://cdn.test/pic.png')).toBe(true);
    expect(isAllowedImageSrc('https://cdn.test/a/b.JPEG')).toBe(true);
  });

  it('allows https URLs with no extension (CDN style)', () => {
    expect(isAllowedImageSrc('https://cdn.test/image/12345')).toBe(true);
  });

  it('allows data:image URIs', () => {
    expect(isAllowedImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('rejects http (insecure), file, blob, and javascript schemes', () => {
    expect(isAllowedImageSrc('http://cdn.test/pic.png')).toBe(false);
    expect(isAllowedImageSrc('file:///etc/passwd')).toBe(false);
    expect(isAllowedImageSrc('blob:https://x/abc')).toBe(false);
    expect(isAllowedImageSrc('javascript:alert(1)')).toBe(false);
  });

  it('rejects https URLs whose extension is not an image', () => {
    expect(isAllowedImageSrc('https://cdn.test/evil.svgz.exe')).toBe(false);
    expect(isAllowedImageSrc('https://cdn.test/script.js')).toBe(false);
  });

  it('rejects non-image data URIs', () => {
    expect(isAllowedImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
  });

  it('rejects empty / blank src', () => {
    expect(isAllowedImageSrc('')).toBe(false);
    expect(isAllowedImageSrc('   ')).toBe(false);
  });
});

describe('sanitizeMarkdownHtml — image policy applied to markup', () => {
  it('drops the src of a disallowed-scheme image', () => {
    const out = sanitizeMarkdownHtml('<img src="http://cdn.test/a.png">');
    expect(out).not.toContain('http://cdn.test/a.png');
  });

  it('keeps the src of an https image', () => {
    const out = sanitizeMarkdownHtml('<img src="https://cdn.test/a.png">');
    expect(out).toContain('https://cdn.test/a.png');
    expect(out).toContain('loading="lazy"');
  });
});
