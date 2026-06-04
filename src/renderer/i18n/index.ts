/**
 * i18n public surface (Wave 1). Wave 2 will import { useT } here to wrap strings
 * across existing components; the App root mounts <I18nProvider> (lead-integrated).
 */

export { I18nProvider, useT, type Translator } from './I18nProvider';
export {
  resolveLocale,
  matchLocale,
  format,
  lookup,
  tableFor,
  SUPPORTED_LOCALES,
  BASE_LOCALE,
  type SupportedLocale,
  type LocaleTable,
} from './resolve';
