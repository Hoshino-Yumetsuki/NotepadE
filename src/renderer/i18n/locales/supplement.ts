/**
 * supplement.ts — renderer-owned i18n overlay for web-port-only strings.
 *
 * These keys have NO UWP .resw origin: the original UWP app either hardcodes them
 * in C# code-behind (e.g. LineEndingUtility.GetLineEndingDisplayText) or they are
 * web/Electron-only chrome with no UWP equivalent (tab scroll buttons, the find
 * match counter). The generated locale tables (locales/*.ts) are a PURE projection
 * of the UWP .resw and are guarded by `port-resw --check`; we therefore do NOT add
 * these keys there. Instead resolve.ts merges this overlay UNDER the generated
 * table (generated always wins) so a key here only resolves when the generated
 * tables don't define it. A disjoint-keys guard (resolve.test.ts) asserts
 * SUPPLEMENT keys ∩ generated keys = ∅, keeping the 29-locale matrix + --check the
 * single source of truth for ported strings.
 *
 * Translation status: AWAITING-TRANSLATION. Every entry currently carries only an
 * 'en-US' value; the runtime fallback is overlay[locale] → overlay['en-US'] → the
 * generated chain, so all 29 locales render the English string until a translation
 * is contributed. To localize, just add the locale tag to the entry, e.g.
 *   'StatusBar_LineEnding_Crlf': { 'en-US': 'Windows (CRLF)', 'de-DE': 'Windows (CRLF)' }
 * No code change is required — the merge in resolve.ts reads whatever tags exist.
 *
 * PA-8: pure data, no imports of fs/path/child_process and no IPC. Imported
 * statically by resolve.ts so the bundler tree-shakes it like any other module.
 */

import type { SupportedLocale } from './index';

/** A per-locale value map for one supplement key; 'en-US' is always present. */
export type SupplementEntry = { 'en-US': string } & Partial<Record<SupportedLocale, string>>;

/**
 * Web-port supplement keys. Key names follow the UWP convention so wave-2
 * string-wrapping references them like any ported key:
 *   - StatusBar_LineEnding_*  — EOL indicator labels (UWP LineEndingUtility, C#).
 *   - TabStrip_*Button.AutomationProperties.Name — web tab-strip aria affordances
 *     (UWP used a single inline "+" and had no scroll buttons).
 *   - FindAndReplace_MatchCountText — the find "N of M" match counter ("{0} of {1}").
 */
export const SUPPLEMENT: Record<string, SupplementEntry> = {
  // EOL display labels (gap #1) — awaiting-translation.
  StatusBar_LineEnding_Crlf: { 'en-US': 'Windows (CRLF)' },
  StatusBar_LineEnding_Cr: { 'en-US': 'Macintosh (CR)' },
  StatusBar_LineEnding_Lf: { 'en-US': 'Unix (LF)' },
  // Tab-strip web aria-labels (gap #3) — awaiting-translation.
  // The hamburger main-menu trigger (UWP MainMenuButton, glyph GlobalNavigationButton)
  // had no explicit AutomationProperties.Name in XAML (it relied on the symbol's
  // default narrator text); the web port declares one for screen-reader parity.
  'MainMenuButton.AutomationProperties.Name': { 'en-US': 'Menu' },
  'TabStrip_NewTabButton.AutomationProperties.Name': { 'en-US': 'New tab' },
  'TabStrip_CloseTabButton.AutomationProperties.Name': { 'en-US': 'Close tab' },
  'TabStrip_ScrollLeftButton.AutomationProperties.Name': { 'en-US': 'Scroll tabs left' },
  'TabStrip_ScrollRightButton.AutomationProperties.Name': { 'en-US': 'Scroll tabs right' },
  // Find match counter (gap #3) — awaiting-translation. {0}=current, {1}=total.
  FindAndReplace_MatchCountText: { 'en-US': '{0} of {1}' },
  // Find/replace a11y aria-labels — awaiting-translation. The web port adds an
  // accessible name on the find/replace container and the replace input (UWP
  // exposed these via AutomationProperties; distinct from the existing
  // FindAndReplace_ReplaceBar.PlaceholderText="Replace" generated key).
  'FindAndReplace_FindAndReplaceControl.AutomationProperties.Name': { 'en-US': 'Find and replace' },
  'FindAndReplace_ReplaceBar.AutomationProperties.Name': { 'en-US': 'Replace with' },
  // Status-bar a11y aria-labels — awaiting-translation. The UWP status bar exposed
  // these affordances via AutomationProperties on its native controls; the web port
  // re-declares them as overlay keys (no .resw origin) for screen-reader parity.
  StatusBar_FilePath: { 'en-US': 'File path' },
  StatusBar_Zoom: { 'en-US': 'Zoom' },
  StatusBar_ZoomLevel: { 'en-US': 'Zoom level' },
  StatusBar_Encoding: { 'en-US': 'Encoding' },
  StatusBar_LineEnding: { 'en-US': 'Line ending' },
  StatusBar_LineColumnGoTo: { 'en-US': 'Line and column, go to line' },
  // Shadow-window (secondary instance) hint title — awaiting-translation.
  StatusBar_ShadowWindowHint: { 'en-US': 'This is a shadow window' },

  // Custom caption-button tooltips (web port) — no UWP .resw origin: the UWP app
  // used OS-drawn title-bar buttons (ApplyThemeForTitleBarButtons) whose tooltips
  // the system supplied. The Electron port draws its own transparent caption
  // buttons (CaptionButtons.tsx) so it declares the tooltips/aria-labels here.
  Caption_Minimize: { 'en-US': 'Minimize', 'de-DE': 'Minimieren', 'ja-JP': '最小化' },
  Caption_Maximize: { 'en-US': 'Maximize', 'de-DE': 'Maximieren', 'ja-JP': '最大化' },
  Caption_Restore: { 'en-US': 'Restore', 'de-DE': 'Wiederherstellen', 'ja-JP': '元に戻す' },
  Caption_Close: { 'en-US': 'Close', 'de-DE': 'Schließen', 'ja-JP': '閉じる' },

  // ---------------------------------------------------------------------------
  // Settings-shell chrome (web port) — no UWP .resw origin. The UWP app used a
  // NavigationView whose section labels reuse the per-page *Page_Title.Content
  // ported keys (Text & Editor / Personalization / Advanced / About) and a
  // "Settings" title from MainMenu_Button_Settings.Text; only the web overlay's
  // own dismiss affordance has no ported equivalent.
  'SettingsShell_Close.AutomationProperties.Name': {
    'en-US': 'Close settings',
    'de-DE': 'Einstellungen schließen',
    'ja-JP': '設定を閉じる'
  },
  // Rail expand/collapse toggle (UWP NavigationView PaneDisplayMode=LeftCompact
  // hamburger). UWP labeled it via the platform NavigationView template; the web
  // port adds its own affordance, so this aria-label has no ported equivalent.
  'SettingsNav_Expand.AutomationProperties.Name': {
    'en-US': 'Toggle navigation pane',
    'de-DE': 'Navigationsbereich umschalten',
    'ja-JP': 'ナビゲーション ウィンドウの切り替え'
  },

  // Settings panes (web port) — strings the UWP pages rendered inline/in code or
  // that the web layout adds. Reuse a ported key wherever one exists; these are
  // only the genuine gaps. en-US-only entries fall through to English in every
  // locale (parity with the existing overlay policy).
  // Personalization — custom accent fields (UWP exposed a single accent toggle;
  // the web port adds an explicit custom-hex editor below it).
  PersonalizationPage_CustomAccentColor_Title: {
    'en-US': 'Custom accent',
    'de-DE': 'Benutzerdefinierte Akzentfarbe',
    'ja-JP': 'カスタム アクセント'
  },
  PersonalizationPage_CustomAccentColor_Description: {
    'en-US': 'Hex color, e.g. #0078D4.',
    'de-DE': 'Hex-Farbe, z. B. #0078D4.',
    'ja-JP': '16 進数の色 (例: #0078D4)。'
  },
  PersonalizationPage_CustomAccentColor_Invalid: {
    'en-US': 'Invalid',
    'de-DE': 'Ungültig',
    'ja-JP': '無効'
  },
  PersonalizationPage_CustomAccentColorPicker_Label: {
    'en-US': 'Custom accent color picker',
    'de-DE': 'Auswahl der benutzerdefinierten Akzentfarbe',
    'ja-JP': 'カスタム アクセント カラーの選択'
  },
  PersonalizationPage_AccentColorSettings_Description: {
    'en-US': 'Follow the system accent.',
    'de-DE': 'Dem Systemakzent folgen.',
    'ja-JP': 'システムのアクセントに従います。'
  },
  // Personalization — custom wallpaper (web port only; the UWP app had no
  // wallpaper feature — its acrylic sampled the desktop directly). MAIN owns
  // the file lifecycle ({userData}/wallpaper/); these are the pane strings.
  // en-US + zh-CN are provided; every other locale falls through to English
  // per the standard overlay policy (awaiting-translation).
  PersonalizationPage_Wallpaper_Title: {
    'en-US': 'Background Image',
    'zh-CN': '背景图片'
  },
  PersonalizationPage_Wallpaper_Description: {
    'en-US':
      'Set a custom background image from a web address or a local file. The image is copied into the app data folder. It replaces the see-through window backdrop, and the tint opacity slider then controls the image blur or opacity, per the background mode below.',
    'zh-CN':
      '从网址或本地文件设置自定义背景图片。图片会被复制到应用数据文件夹中。它将替代窗口的透视背景，此后“背景色调不透明度”滑块将根据下方的背景模式控制图片的模糊程度或不透明度。'
  },
  PersonalizationPage_Wallpaper_UrlLabel: {
    'en-US': 'Image URL',
    'zh-CN': '图片网址'
  },
  PersonalizationPage_Wallpaper_SetFromUrlButton: {
    'en-US': 'Set',
    'zh-CN': '设置'
  },
  PersonalizationPage_Wallpaper_LocalLabel: {
    'en-US': 'Local image',
    'zh-CN': '本地图片'
  },
  PersonalizationPage_Wallpaper_BrowseButton: {
    'en-US': 'Browse…',
    'zh-CN': '浏览…'
  },
  PersonalizationPage_Wallpaper_ClearButton: {
    'en-US': 'Remove background image',
    'zh-CN': '移除背景图片'
  },
  PersonalizationPage_Wallpaper_OpacityHint: {
    'en-US':
      'controls the background image blur or opacity while one is set, per the background mode',
    'zh-CN': '设置背景图片后，根据背景模式设置，此滑块控制图片的模糊程度或不透明度'
  },
  // Background-mode toggle (blur vs opacity) — shown only while a wallpaper is
  // active; the Switch's own label announces the CURRENT mode (the
  // OnContent/OffContent pattern of the UWP toggle strings).
  PersonalizationPage_Wallpaper_EffectLabel: {
    'en-US': 'Background mode',
    'zh-CN': '背景模式'
  },
  PersonalizationPage_Wallpaper_EffectDescription: {
    'en-US': 'Choose whether the slider above controls the image blur or its opacity',
    'zh-CN': '选择上方滑块控制图片的模糊程度还是不透明度'
  },
  PersonalizationPage_Wallpaper_EffectBlur: {
    'en-US': 'Blur',
    'zh-CN': '模糊'
  },
  PersonalizationPage_Wallpaper_EffectOpacity: {
    'en-US': 'Opacity',
    'zh-CN': '不透明度'
  },
  // Advanced — "Reset all settings" (web port only; UWP had no factory-reset
  // affordance — its settings store silently re-initialized defaults). en-US +
  // zh-CN provided; other locales fall through to English (overlay policy).
  AdvancedPage_ResetSettings_Title: {
    'en-US': 'Reset Settings',
    'zh-CN': '重置设置'
  },
  AdvancedPage_ResetSettings_Description: {
    'en-US':
      'Restore every setting to its default value, including the custom background image (its file is deleted).',
    'zh-CN': '将所有设置恢复为默认值，包括自定义背景图片（其文件将被删除）。'
  },
  AdvancedPage_ResetSettings_Button: {
    'en-US': 'Reset all settings',
    'zh-CN': '重置所有设置'
  },
  AdvancedPage_ResetSettings_ConfirmTitle: {
    'en-US': 'Reset all settings?',
    'zh-CN': '要重置所有设置吗？'
  },
  AdvancedPage_ResetSettings_ConfirmBody: {
    'en-US':
      'All settings will be restored to their defaults and the custom background image will be removed. This cannot be undone.',
    'zh-CN': '所有设置将恢复为默认值，自定义背景图片将被移除。此操作无法撤销。'
  },
  AdvancedPage_ResetSettings_ConfirmButton: {
    'en-US': 'Reset',
    'zh-CN': '重置'
  },
  AdvancedPage_ResetSettings_CancelButton: {
    'en-US': 'Cancel',
    'zh-CN': '取消'
  },
  // Text & Editor — the web port labels the font-family dropdown explicitly and
  // gives the web-search section its own group header.
  TextAndEditorPage_FontFamilySettings_Title: {
    'en-US': 'Font family',
    'de-DE': 'Schriftartfamilie',
    'ja-JP': 'フォント ファミリ'
  },
  TextAndEditorPage_FontFamily_SystemDefault: {
    'en-US': 'System Default',
    'zh-CN': '系统默认',
    'de-DE': 'Systemstandard',
    'ja-JP': 'システム既定'
  },
  TextAndEditorPage_WebSearch_GroupTitle: {
    'en-US': 'Web search',
    'de-DE': 'Websuche',
    'ja-JP': 'Web 検索'
  },
  TextAndEditorPage_CustomSearchUrl_Description: {
    'en-US': 'Use {0} where the query should go.',
    'de-DE': 'Verwenden Sie {0} an der Stelle der Suchanfrage.',
    'ja-JP': 'クエリを挿入する位置に {0} を使用します。'
  },
  // About — the web port groups the links and renders a "Version {0}" line.
  AboutPage_Links_GroupTitle: {
    'en-US': 'Links',
    'de-DE': 'Links',
    'ja-JP': 'リンク'
  },
  AboutPage_BuiltWith_GroupTitle: {
    'en-US': 'Built with',
    'de-DE': 'Entwickelt mit',
    'ja-JP': '使用ライブラリ'
  },
  AboutPage_Version_Label: {
    'en-US': 'Version {0}',
    'de-DE': 'Version {0}',
    'ja-JP': 'バージョン {0}'
  },
  // Updater — auto-check toggle + check button + dialog labels (web-port-only).
  Updates_AutoCheckToggle: {
    'en-US': 'Automatically check for updates',
    'zh-CN': '自动检查更新'
  },
  Updates_CheckButton: {
    'en-US': 'Check for updates',
    'zh-CN': '检查更新'
  },
  Updates_UpToDate: {
    'en-US': 'You are up to date!',
    'zh-CN': '已是最新版本！'
  },
  Updates_Available: {
    'en-US': 'A new version {0} is available.',
    'zh-CN': '发现新版本 {0}。'
  },
  Updates_InstallNow: {
    'en-US': 'Update now',
    'zh-CN': '立即更新'
  },
  Updates_Later: {
    'en-US': 'Later',
    'zh-CN': '稍后'
  },
  Updates_CheckFailed: {
    'en-US': 'Failed to check for updates.',
    'zh-CN': '检查更新失败。'
  },
  Updates_Checking: {
    'en-US': 'Checking for updates…',
    'zh-CN': '正在检查更新…'
  },
  Updates_DialogTitle: {
    'en-US': 'Update Available',
    'zh-CN': '发现更新'
  }
};
