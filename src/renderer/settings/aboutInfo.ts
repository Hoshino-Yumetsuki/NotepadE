/**
 * Build-time app constants for the About pane (Phase 5, Stream C).
 *
 * The version is a renderer-side constant (no IPC needed). Phase 6 may surface
 * the real package version via window.notepads.app; until then this single
 * source keeps the About pane and any future "about" command consistent.
 *
 * PA-8: pure data — no fs/path/child_process, no IPC.
 */

/** Display version for the About pane. Bump alongside package.json on release. */
export const APP_VERSION = '0.0.0';

/** Product name (matches the UWP About header). */
export const APP_NAME = 'Notepads';

/** Upstream + support links (verbatim from UWP AboutPage.xaml). */
export const ABOUT_LINKS: readonly { label: string; url: string }[] = [
  { label: 'Website', url: 'https://www.NotepadsApp.com' },
  { label: 'Source code', url: 'https://github.com/0x7c13/Notepads' },
  { label: 'Report an issue', url: 'https://github.com/0x7c13/Notepads/issues' },
  { label: 'Release notes', url: 'https://github.com/0x7c13/Notepads/releases' },
  { label: 'Privacy policy', url: 'https://github.com/0x7c13/Notepads/blob/master/PRIVACY.md' },
];

/** Third-party dependency credits (verbatim from UWP AboutPage.xaml). */
export const DEPENDENCY_CREDITS: readonly { label: string; url: string }[] = [
  { label: 'UTF-unknown', url: 'https://github.com/CharsetDetector/UTF-unknown' },
  { label: 'ColorCode-Universal', url: 'https://github.com/WilliamABradley/ColorCode-Universal' },
  { label: 'DiffPlex', url: 'https://github.com/mmanela/diffplex' },
  { label: 'Windows Community Toolkit', url: 'https://github.com/windows-toolkit/WindowsCommunityToolkit' },
];

/** License + disclaimer line. */
export const ABOUT_DISCLAIMER =
  'Notepads is a free and open-source app distributed under the MIT License. ' +
  'This Electron edition is a 1:1 rewrite of the original UWP app.';
