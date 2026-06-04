/**
 * ============================================================================
 *  I18nProvider + useT — live, no-reload localization for the renderer
 * ============================================================================
 *
 * The single source of truth for the app's active locale + translator. It binds
 * to the MAIN-owned `settings.appLanguage` exactly like useAppTheme binds to the
 * theme settings, and resolves the OS UI language from the renderer's own
 * `navigator.languages` (Chromium reports the app/OS UI locale there — PA-8-safe,
 * no new IPC and no change to the frozen contract).
 *
 *   appLanguage === ''        → follow navigator.languages (first supported match),
 *   appLanguage === '<tag>'   → that BCP-47 tag (tolerant match), else OS, else en-US.
 *
 * A change to appLanguage (this window OR any other window / external write)
 * arrives via settings.onChanged and re-resolves the table with NO reload — the
 * provider swaps the context value and every useT() consumer re-renders.
 *
 * useT() returns:
 *   - t(key, ...args)               → localized string, {0}/{1} substituted,
 *   - plural(count, singularKey, pluralKey, ...args) → UWP-parity plural select,
 *   - locale                        → the resolved SupportedLocale tag.
 *
 * Missing keys fall back to en-US then to the key itself (see resolve.lookup).
 *
 * PA-8: consumes ONLY window.notepads.settings + navigator — no fs/path/
 * child_process, no raw IPC bridge access.
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import {
  resolveLocale,
  tableFor,
  lookup,
  format,
  BASE_LOCALE,
  type LocaleTable,
  type SupportedLocale,
} from './resolve';

/** What useT() hands every consumer. */
export interface Translator {
  /** Localize `key`, substituting {0}/{1}… with `args`; missing → en-US → key. */
  t(key: string, ...args: Array<string | number>): string;
  /**
   * UWP-parity pluralization: the UWP app ships explicit *_SingularX / *_PluralX
   * key pairs and picks between them by count. `plural` reproduces that — count
   * === 1 (and -1) selects the singular key, every other count the plural key —
   * then formats the chosen string with `args` (count is NOT auto-injected; pass
   * it positionally if the template uses it).
   */
  plural(
    count: number,
    singularKey: string,
    pluralKey: string,
    ...args: Array<string | number>
  ): string;
  /** The resolved locale tag currently in effect. */
  locale: SupportedLocale;
}

interface I18nContextValue {
  locale: SupportedLocale;
  table: LocaleTable;
}

const I18nContext = createContext<I18nContextValue>({
  locale: BASE_LOCALE,
  table: tableFor(BASE_LOCALE),
});

/** Read navigator.languages (fallback to [navigator.language]) defensively. */
function readUiLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages;
  }
  return navigator.language ? [navigator.language] : [];
}

/**
 * Live i18n provider. Pulls the persisted settings once, tracks appLanguage via
 * settings.onChanged, tracks the OS UI language via the `languagechange` event,
 * and re-resolves the active table on either signal — no reload.
 */
export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [appLanguage, setAppLanguage] = useState<string>(DEFAULT_SETTINGS.appLanguage);
  const [uiLanguages, setUiLanguages] = useState<readonly string[]>(() => readUiLanguages());

  // Initial pull of the persisted appLanguage.
  useEffect(() => {
    let alive = true;
    void window.notepads.settings.get().then((r) => {
      if (alive && r.ok) setAppLanguage(r.data.appLanguage);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Live: settings changes (this or any other window / external write).
  useEffect(
    () => window.notepads.settings.onChanged((s) => setAppLanguage(s.appLanguage)),
    [],
  );

  // Live: OS / browser UI language changes (the runtime re-resolves when
  // appLanguage follows the OS, i.e. appLanguage === '').
  useEffect(() => {
    const onChange = (): void => setUiLanguages(readUiLanguages());
    window.addEventListener('languagechange', onChange);
    return () => window.removeEventListener('languagechange', onChange);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const locale = resolveLocale(appLanguage, uiLanguages);
    return { locale, table: tableFor(locale) };
  }, [appLanguage, uiLanguages]);

  return createElement(I18nContext.Provider, { value }, children);
}

/** Access the live translator. Must be used under <I18nProvider>. */
export function useT(): Translator {
  const { locale, table } = useContext(I18nContext);
  return useMemo<Translator>(
    () => ({
      locale,
      t: (key, ...args) => format(lookup(table, key, locale), args),
      plural: (count, singularKey, pluralKey, ...args) => {
        const key = Math.abs(count) === 1 ? singularKey : pluralKey;
        return format(lookup(table, key, locale), args);
      },
    }),
    [locale, table],
  );
}
