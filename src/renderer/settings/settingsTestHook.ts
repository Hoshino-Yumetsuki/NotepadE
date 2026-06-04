/**
 * Settings test seam (Phase 5, Lane C) — installs window.__notepadsTest.settings.
 *
 * PA-8-clean: composes only live getters the App already owns (the settings bag
 * from useSettings, the resolved theme bucket from useAppTheme, and the
 * open/close setters for the settings surface). It adds NO IPC surface — reads
 * pass through the in-renderer state the UI itself renders from.
 *
 * Gated by the App behind NOTEPADS_E2E, so it is absent in production. Attaches
 * to the same window.__notepadsTest object installTestHook created.
 *
 * MUST stay in sync with NotepadsSettingsTestHook in e2e/types/notepads-global.d.ts.
 */

import type { Settings } from '@shared/ipc-contract';
import type { AppTheme } from '../theme/tokens';

export interface SettingsSeamAccessors {
  open(): void;
  close(): void;
  getSettings(): Settings;
  getResolvedTheme(): AppTheme;
}

/**
 * Install the settings seam onto window.__notepadsTest.settings. The accessors
 * are getters/callbacks so the seam always sees the live state. Returns an
 * uninstall function. Requires installTestHook to have run first.
 */
export function installSettingsTestHook(acc: SettingsSeamAccessors): () => void {
  if (typeof window === 'undefined') return () => {};

  const seam = {
    openSettings(): void {
      acc.open();
    },
    closeSettings(): void {
      acc.close();
    },
    getActiveTheme(): AppTheme {
      return acc.getResolvedTheme();
    },
    getSetting<K extends keyof Settings>(key: K): Settings[K] {
      return acc.getSettings()[key];
    },
  };

  const existing = window.__notepadsTest;
  if (existing) existing.settings = seam;

  return () => {
    if (window.__notepadsTest) window.__notepadsTest.settings = undefined;
  };
}
