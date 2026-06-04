/**
 * resolve.ts — pure locale-resolution + string-formatting logic for the renderer
 * i18n framework. No React, no IPC, no fs — just data in / string out, so the
 * loader, fallback, and placeholder rules are unit-testable in isolation.
 *
 * Resolution mirrors the UWP behaviour the contract froze in `settings.appLanguage`:
 *   - appLanguage === ''  → follow the OS / app UI language (Chromium exposes this
 *     via navigator.language[s]; we match it against the 29 ported tags),
 *   - appLanguage === '<BCP-47>' → use that exact tag (matched tolerantly).
 *
 * Matching is tolerant because the UWP tag casing isn't canonical BCP-47
 * (e.g. `sr-cyrl`, `sr-Latn`) and the OS may report a base language only
 * (`fr` → `fr-FR`, `pt` → `pt-PT`/`pt-BR` by first match). Anything unresolved
 * falls back to BASE_LOCALE (en-US), and any missing KEY within a resolved table
 * falls back to the en-US value, then to the key itself.
 */

import {
  LOCALE_TABLES,
  SUPPORTED_LOCALES,
  BASE_LOCALE,
  type LocaleTable,
  type SupportedLocale,
} from './locales/index';
import { SUPPLEMENT } from './locales/supplement';

export { SUPPORTED_LOCALES, BASE_LOCALE, type SupportedLocale, type LocaleTable };

/** Lower-cased lookup index: normalized tag -> canonical supported tag. */
const NORMALIZED_INDEX: Map<string, SupportedLocale> = (() => {
  const m = new Map<string, SupportedLocale>();
  for (const tag of SUPPORTED_LOCALES) m.set(tag.toLowerCase(), tag);
  return m;
})();

/** First supported tag whose base language (before '-') equals `base`. */
function firstByBaseLanguage(base: string): SupportedLocale | undefined {
  const lower = base.toLowerCase();
  for (const tag of SUPPORTED_LOCALES) {
    if (tag.toLowerCase().split('-')[0] === lower) return tag;
  }
  return undefined;
}

/**
 * Match one requested tag against the supported set:
 *   1. exact (case-insensitive) tag match,
 *   2. base-language match (`fr-CA` → first `fr-*`, `pt` → first `pt-*`).
 * Returns undefined if nothing matches.
 */
export function matchLocale(requested: string): SupportedLocale | undefined {
  const tag = requested.trim();
  if (!tag) return undefined;
  const exact = NORMALIZED_INDEX.get(tag.toLowerCase());
  if (exact) return exact;
  return firstByBaseLanguage(tag.split('-')[0]);
}

/**
 * Resolve the effective locale from the persisted setting + the OS UI languages.
 *   - explicit appLanguage wins (if it matches a supported tag; else fall through),
 *   - else walk navigator.languages in order, taking the first that matches,
 *   - else BASE_LOCALE.
 * `uiLanguages` is injected (navigator.languages) so this stays pure/testable.
 */
export function resolveLocale(appLanguage: string, uiLanguages: readonly string[]): SupportedLocale {
  if (appLanguage.trim()) {
    const explicit = matchLocale(appLanguage);
    if (explicit) return explicit;
  }
  for (const lang of uiLanguages) {
    const matched = matchLocale(lang);
    if (matched) return matched;
  }
  return BASE_LOCALE;
}

/**
 * Substitute .NET-style positional placeholders (`{0}`, `{1}`, …) with `args`.
 * Unmatched indices are left verbatim (parity with String.Format throwing is not
 * desirable at runtime — a missing arg should degrade, not crash the UI).
 * A literal brace is written `{{` / `}}` in the source string, matching .NET.
 */
export function format(template: string, args: ReadonlyArray<string | number> = []): string {
  return template.replace(/\{\{|\}\}|\{(\d+)\}/g, (whole, index?: string) => {
    if (whole === '{{') return '{';
    if (whole === '}}') return '}';
    const i = Number(index);
    const v = args[i];
    return v === undefined ? whole : String(v);
  });
}

/**
 * Look a key up in `table`, falling back to the en-US table, then to the
 * web-port SUPPLEMENT overlay (locale value → en-US value), then to the key
 * itself (so a never-translated key is visible rather than blank). This is the
 * single missing-key policy the whole framework shares.
 *
 * The generated tables ALWAYS win: the supplement is consulted only after both
 * the resolved table and the en-US generated table miss, so a supplement key can
 * never shadow a ported .resw key (the disjoint-keys guard in resolve.test.ts
 * asserts the two key sets never overlap anyway). `locale` selects the per-locale
 * supplement value; omitted (or absent in the entry) → the entry's en-US value.
 */
export function lookup(table: LocaleTable, key: string, locale?: SupportedLocale): string {
  const direct = table[key];
  if (direct !== undefined) return direct;
  const base = LOCALE_TABLES[BASE_LOCALE][key];
  if (base !== undefined) return base;
  const sup = SUPPLEMENT[key];
  if (sup !== undefined) return (locale && sup[locale]) ?? sup['en-US'];
  return key;
}

/** The string table for a resolved locale (always defined for SupportedLocale). */
export function tableFor(locale: SupportedLocale): LocaleTable {
  return LOCALE_TABLES[locale];
}
