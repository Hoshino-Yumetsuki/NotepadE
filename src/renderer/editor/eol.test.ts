import { describe, it, expect } from 'vitest';
import { SHADOW_EOL, normalizeToShadow } from './eol';

/**
 * Shadow-buffer normalization is the renderer's only EOL transform. It must
 * collapse CRLF / CR / LF (and mixtures) to a single '\n' WITHOUT inferring or
 * emitting any EOL label — the authoritative eolId comes from MAIN (docs/plan/04
 * §3.A). These tests pin that pure-string behavior.
 */
describe('normalizeToShadow', () => {
  it('uses "\\n" as the shadow line break', () => {
    expect(SHADOW_EOL).toBe('\n');
  });

  it('converts CRLF to LF', () => {
    expect(normalizeToShadow('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('converts bare CR to LF', () => {
    expect(normalizeToShadow('a\rb\rc')).toBe('a\nb\nc');
  });

  it('leaves LF untouched', () => {
    expect(normalizeToShadow('a\nb\nc')).toBe('a\nb\nc');
  });

  it('handles mixed CRLF + CR + LF without leaving stray breaks', () => {
    expect(normalizeToShadow('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('does not introduce a "\\r" anywhere', () => {
    const out = normalizeToShadow('x\r\ny\rz\n');
    expect(out.includes('\r')).toBe(false);
  });

  it('preserves trailing whitespace and a missing final newline', () => {
    expect(normalizeToShadow('line one   \r\nlast no newline')).toBe(
      'line one   \nlast no newline'
    );
  });

  it('is a no-op on empty input', () => {
    expect(normalizeToShadow('')).toBe('');
  });
});
