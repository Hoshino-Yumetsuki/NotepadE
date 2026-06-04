/**
 * Unit tests for the pure i18n resolution + formatting logic (resolve.ts).
 * No React, no IPC — exercises loader, locale matching, fallback, and the
 * .NET-style placeholder formatter directly against the ported tables.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveLocale,
  matchLocale,
  format,
  lookup,
  tableFor,
  SUPPORTED_LOCALES,
  BASE_LOCALE,
} from './resolve';

describe('i18n locale set', () => {
  it('ports all 29 UWP locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(29);
  });

  it('includes en-US as the base locale and it is non-empty', () => {
    expect(SUPPORTED_LOCALES).toContain(BASE_LOCALE);
    expect(Object.keys(tableFor(BASE_LOCALE)).length).toBeGreaterThan(0);
  });

  it('every locale shares the en-US key set (key parity)', () => {
    const baseKeys = Object.keys(tableFor(BASE_LOCALE)).sort();
    for (const tag of SUPPORTED_LOCALES) {
      expect(Object.keys(tableFor(tag)).sort()).toEqual(baseKeys);
    }
  });
});

describe('matchLocale', () => {
  it('matches an exact tag', () => {
    expect(matchLocale('en-US')).toBe('en-US');
    expect(matchLocale('zh-CN')).toBe('zh-CN');
  });

  it('matches case-insensitively (UWP casing is not canonical)', () => {
    expect(matchLocale('SR-LATN')).toBe('sr-Latn');
    expect(matchLocale('sr-cyrl')).toBe('sr-cyrl');
  });

  it('falls back from a base language to the first matching region', () => {
    // 'fr' → fr-FR, 'pt' → first pt-* in the supported order (pt-BR before pt-PT).
    expect(matchLocale('fr')).toBe('fr-FR');
    expect(matchLocale('fr-CA')).toBe('fr-FR');
  });

  it('returns undefined for an unsupported tag', () => {
    expect(matchLocale('xx-YY')).toBeUndefined();
    expect(matchLocale('')).toBeUndefined();
  });
});

describe('resolveLocale', () => {
  it("explicit appLanguage wins over the OS languages", () => {
    expect(resolveLocale('ja-JP', ['en-US'])).toBe('ja-JP');
  });

  it("follows the OS UI languages when appLanguage is ''", () => {
    expect(resolveLocale('', ['de-DE', 'en-US'])).toBe('de-DE');
    expect(resolveLocale('', ['fr'])).toBe('fr-FR');
  });

  it('falls back to en-US when nothing matches', () => {
    expect(resolveLocale('', ['xx-YY'])).toBe(BASE_LOCALE);
    expect(resolveLocale('', [])).toBe(BASE_LOCALE);
  });

  it('falls through an unmatched explicit tag to the OS languages', () => {
    expect(resolveLocale('xx-YY', ['ko-KR'])).toBe('ko-KR');
  });
});

describe('format (.NET positional placeholders)', () => {
  it('substitutes {0}/{1} positionally', () => {
    expect(format('Ln {0}, Col {1}', [3, 7])).toBe('Ln 3, Col 7');
  });

  it('leaves an unmatched index verbatim instead of crashing', () => {
    expect(format('Sorry, file "{0}": {1}', ['a.txt'])).toBe('Sorry, file "a.txt": {1}');
  });

  it('honours escaped braces {{ }}', () => {
    expect(format('{{literal}} {0}', ['x'])).toBe('{literal} x');
  });
});

describe('lookup (missing-key fallback)', () => {
  it('returns the locale value when present', () => {
    const en = tableFor('en-US');
    const key = Object.keys(en)[0];
    expect(lookup(en, key)).toBe(en[key]);
  });

  it('falls back to en-US for a key missing in the target table', () => {
    // Synthesize a sparse table missing a known key; lookup must reach en-US.
    const en = tableFor('en-US');
    const knownKey = Object.keys(en)[0];
    expect(lookup({}, knownKey)).toBe(en[knownKey]);
  });

  it('falls back to the key itself when absent everywhere', () => {
    expect(lookup({}, 'Totally_Unknown_Key')).toBe('Totally_Unknown_Key');
  });
});
