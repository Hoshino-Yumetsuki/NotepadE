/**
 * Static option tables for the settings panes (Phase 5, Stream C).
 *
 * These are pure data the dropdowns render. The language list is the verbatim
 * 29-locale set shipped by UWP (Notepads/src/Notepads/Strings/* folders); the
 * i18n BINDING (actually switching the UI language) is Phase 6 — here the
 * selector only persists the chosen BCP-47 tag via settings.appLanguage.
 *
 * PA-8: pure data — no fs/path/child_process, no IPC.
 */

import type {
  TabIndents,
  SearchEngineId,
  EncodingId
} from '@shared/ipc-contract';
import { UNICODE_ENCODINGS } from '../statusbar/statusModel';

/** The 29 UWP-shipped locales (Strings/* folders), BCP-47 + English label. */
export const APP_LANGUAGES: readonly { tag: string; label: string }[] = [
  { tag: '', label: 'System default' },
  { tag: 'ar-YE', label: 'العربية (اليمن)' },
  { tag: 'bg-BG', label: 'Български' },
  { tag: 'cs-CZ', label: 'Čeština' },
  { tag: 'de-CH', label: 'Deutsch (Schweiz)' },
  { tag: 'de-DE', label: 'Deutsch (Deutschland)' },
  { tag: 'en-US', label: 'English (United States)' },
  { tag: 'es-ES', label: 'Español' },
  { tag: 'fi-FI', label: 'Suomi' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'hi-IN', label: 'हिन्दी' },
  { tag: 'hr-HR', label: 'Hrvatski' },
  { tag: 'hu-HU', label: 'Magyar' },
  { tag: 'it-IT', label: 'Italiano' },
  { tag: 'ja-JP', label: '日本語' },
  { tag: 'ka-GE', label: 'ქართული' },
  { tag: 'ko-KR', label: '한국어' },
  { tag: 'nl-NL', label: 'Nederlands' },
  { tag: 'or-IN', label: 'ଓଡ଼ିଆ' },
  { tag: 'pl-PL', label: 'Polski' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'pt-PT', label: 'Português (Portugal)' },
  { tag: 'ru-RU', label: 'Русский' },
  { tag: 'sr-Latn', label: 'Srpski (latinica)' },
  { tag: 'sr-cyrl', label: 'Српски (ћирилица)' },
  { tag: 'tr-TR', label: 'Türkçe' },
  { tag: 'uk-UA', label: 'Українська' },
  { tag: 'vi-VN', label: 'Tiếng Việt' },
  { tag: 'zh-CN', label: '简体中文' },
  { tag: 'zh-TW', label: '繁體中文' }
];

/** Tab-as-spaces width options (UWP EditorDefaultTabIndents); -1 = real tab. */
export const TAB_INDENTS: readonly { value: TabIndents; label: string }[] = [
  { value: -1, label: 'Tab' },
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' }
];

/** Web-search engine options (UWP SearchEngine enum). */
export const SEARCH_ENGINES: readonly { id: SearchEngineId; label: string }[] = [
  { id: 'bing', label: 'Bing' },
  { id: 'google', label: 'Google' },
  { id: 'duckDuckGo', label: 'DuckDuckGo' },
  { id: 'custom', label: 'Custom' }
];

/**
 * Default-encoding radio options (UWP TextAndEditorSettingsPage EncodingPanel:
 * UTF-8 / UTF-8-BOM / UTF-16 LE BOM / UTF-16 BE BOM). Reuses the SAME four Unicode
 * labels the status-bar encoding menu lists, so the opaque encodingId stays the
 * single source of truth.
 */
export const ENCODING_OPTIONS: readonly { id: EncodingId; label: string }[] = UNICODE_ENCODINGS.map(
  (id) => ({ id, label: id })
);

/** Font families offered for the editor. Empty string = system default. */
export const FONT_FAMILIES: readonly string[] = [
  '',
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'Courier New',
  'Lucida Console',
  'Segoe UI'
];

/** Tint-opacity slider bounds (0..1, default 0.75 per ThemeSettingsService). */
export const TINT_MIN = 0;
export const TINT_MAX = 1;
export const TINT_STEP = 0.05;

/** Editor font-size bounds (UWP allows a wide range; pin a sane editor span). */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;
