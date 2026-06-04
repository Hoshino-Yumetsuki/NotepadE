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
import { SUPPLEMENT } from './locales/supplement';

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

describe('SUPPLEMENT overlay (web-port keys with no .resw origin)', () => {
  it('is DISJOINT from the generated tables — never shadows a ported key', () => {
    // The core invariant: a supplement key must only ADD a key absent from the
    // generated tables, so the 29-locale matrix + port-resw --check stay the
    // single source of truth for ported strings. Checked against en-US (every
    // generated locale shares the en-US key set per the key-parity test above).
    const generatedKeys = new Set(Object.keys(tableFor(BASE_LOCALE)));
    const overlap = Object.keys(SUPPLEMENT).filter((k) => generatedKeys.has(k));
    expect(overlap).toEqual([]);
  });

  it('every supplement entry carries an en-US value', () => {
    for (const [key, entry] of Object.entries(SUPPLEMENT)) {
      expect(entry['en-US'], `${key} missing en-US`).toBeTruthy();
    }
  });

  it('resolves a supplement key only after the generated chain misses', () => {
    // Not in the resolved table nor the generated en-US table → overlay supplies it.
    expect(lookup(tableFor('en-US'), 'StatusBar_LineEnding_Crlf', 'en-US')).toBe('Windows (CRLF)');
    expect(lookup(tableFor('zh-CN'), 'FindAndReplace_MatchCountText', 'zh-CN')).toBe('{0} of {1}');
  });

  it('falls a supplement key through to its en-US value when the locale is untranslated', () => {
    // Entries are en-US-only for now; any resolved locale gets the en-US string.
    expect(lookup(tableFor('de-DE'), 'TabStrip_NewTabButton.AutomationProperties.Name', 'de-DE')).toBe(
      'New tab',
    );
  });

  it('does not let a supplement key override a real generated key', () => {
    // A known ported key resolves from the generated table, not the overlay,
    // even if a same-named overlay entry existed (it cannot, per the disjoint guard).
    const en = tableFor('en-US');
    const portedKey = 'TextEditor_LineColumnIndicator_ShortText';
    expect(lookup(en, portedKey, 'en-US')).toBe(en[portedKey]);
  });
});
