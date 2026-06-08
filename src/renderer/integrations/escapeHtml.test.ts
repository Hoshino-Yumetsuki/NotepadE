import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

/** HTML-escaping parity for the print-host string builder. */
describe('escapeHtml', () => {
  it('escapes all five metacharacters', () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('escapes ampersand first to avoid double-encoding', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
