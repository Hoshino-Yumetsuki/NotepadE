import { describe, it, expect } from 'vitest';
import { resolveSearchUrl, templateForEngine } from './searchUrl';

/**
 * Web-search URL resolution parity (UWP SearchEngineUtility + TextEditorCore.WebSearch).
 * Pure logic — no electron, no shell. Asserts the URL-vs-query decision, the '+'-join
 * whitespace handling, the verbatim engine templates, and the custom-engine path.
 */

describe('templateForEngine', () => {
  it('returns the verbatim UWP templates for built-in engines', () => {
    expect(templateForEngine('bing', '')).toBe('https://www.bing.com/search?q={0}&form=NPCTXT');
    expect(templateForEngine('google', '')).toBe('https://www.google.com/search?q={0}&oq={0}');
    expect(templateForEngine('duckDuckGo', '')).toBe('https://duckduckgo.com/?q={0}&ia=web');
  });

  it('returns the user customSearchUrl for the custom engine', () => {
    expect(templateForEngine('custom', 'https://x.test/?s={0}')).toBe('https://x.test/?s={0}');
  });
});

describe('resolveSearchUrl', () => {
  it('returns null for an empty / whitespace query (no-op)', () => {
    expect(resolveSearchUrl('', 'bing', '')).toBeNull();
    expect(resolveSearchUrl('   ', 'bing', '')).toBeNull();
  });

  it('launches an absolute http/https URL directly (no engine formatting)', () => {
    expect(resolveSearchUrl('https://example.com/path?x=1', 'bing', '')).toBe(
      'https://example.com/path?x=1'
    );
    expect(resolveSearchUrl('http://example.com', 'google', '')).toBe('http://example.com');
  });

  it('does NOT treat non-http schemes as direct URLs — formats them as a query', () => {
    // ftp:// and file:// are not http/https → fall through to the search engine.
    const out = resolveSearchUrl('ftp://host/file', 'bing', '');
    expect(out).toContain('bing.com/search?q=');
    expect(out).not.toBe('ftp://host/file');
  });

  it('formats a plain query with the Bing template, +-joining whitespace', () => {
    expect(resolveSearchUrl('hello world', 'bing', '')).toBe(
      'https://www.bing.com/search?q=hello+world&form=NPCTXT'
    );
  });

  it('collapses runs of mixed whitespace to a single + (NET Split(null) parity)', () => {
    expect(resolveSearchUrl('a  b\t c\nd', 'duckDuckGo', '')).toBe(
      'https://duckduckgo.com/?q=a+b+c+d&ia=web'
    );
  });

  it('substitutes the query into BOTH {0} placeholders for Google', () => {
    expect(resolveSearchUrl('foo bar', 'google', '')).toBe(
      'https://www.google.com/search?q=foo+bar&oq=foo+bar'
    );
  });

  it('uses the custom template when the engine is custom', () => {
    expect(resolveSearchUrl('cats', 'custom', 'https://s.test/?query={0}')).toBe(
      'https://s.test/?query=cats'
    );
  });

  it('returns null for a custom engine with no configured URL', () => {
    expect(resolveSearchUrl('cats', 'custom', '')).toBeNull();
  });

  it('returns null when the custom template resolves to a non-http(s) URL', () => {
    expect(resolveSearchUrl('cats', 'custom', 'notaurl-{0}')).toBeNull();
  });

  it('trims the query before deciding (leading/trailing whitespace ignored)', () => {
    expect(resolveSearchUrl('  https://example.com  ', 'bing', '')).toBe('https://example.com');
    expect(resolveSearchUrl('  spaced query  ', 'bing', '')).toBe(
      'https://www.bing.com/search?q=spaced+query&form=NPCTXT'
    );
  });
});
