/**
 * Build-time app constants for the About pane (Phase 5, Stream C).
 *
 * The version is inlined at build time from package.json via Vite's `define`
 * (__APP_VERSION__) — UWP surfaced Package.Current.Id.Version. No IPC needed.
 *
 * PA-8: pure data — no fs/path/child_process, no IPC.
 */

/** Injected by Vite `define` from package.json at build time. */
declare const __APP_VERSION__: string;

/** Display version for the About pane (from package.json, inlined at build). */
export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : '0.0.0';

/** Product name (this Electron edition). */
export const APP_NAME = 'NotepadE';

/** Upstream + support links (verbatim from UWP AboutPage.xaml). */
export const ABOUT_LINKS: readonly { label: string; url: string }[] = [
  /* { label: 'Website', url: 'https://www.NotepadsApp.com' },*/
  { label: 'Source code', url: 'https://github.com/0x7c13/Notepads' },
  /* { label: 'Report an issue', url: 'https://github.com/0x7c13/Notepads/issues' },
  { label: 'Release notes', url: 'https://github.com/0x7c13/Notepads/releases' },
  { label: 'Privacy policy', url: 'https://github.com/0x7c13/Notepads/blob/master/PRIVACY.md' }, */
];

/** Third-party dependency credits (verbatim from UWP AboutPage.xaml). */
export const DEPENDENCY_CREDITS: readonly { label: string; url: string }[] = [
  { label: 'Fluent UI', url: 'https://github.com/microsoft/fluentui' },
  { label: 'React', url: 'https://github.com/facebook/react' }
];

/** License + disclaimer line. */
export const ABOUT_DISCLAIMER =
  ' NotepadE is a free and open-source app distributed under the GPL-3.0 license. ' /* +
  'This Electron edition is a 1:1 rewrite of the original UWP app.'; */
