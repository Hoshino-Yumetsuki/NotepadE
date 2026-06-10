/**
 * "Reset all settings" — MAIN only (UWP had no such affordance; web-port-only
 * recovery hatch for a misconfigured app: broken font, unreadable transparency,
 * bad wallpaper, etc.).
 *
 * Lives in its OWN module (not settings.ts) deliberately: the reset must reuse
 * wallpaper.ts's clearWallpaper() for the managed-file deletion (single owner
 * of that lifecycle — no duplicated delete logic), and wallpaper.ts already
 * imports settings.ts (getSettings/setSettings); folding the reset into
 * settings.ts would create a settings ⇄ wallpaper import cycle. This module
 * sits above both and imports each one-way.
 *
 * Reset order:
 *   1. clearWallpaper() — empties `wallpaperFileName` AND deletes the managed
 *      file under {userData}/wallpaper/ (its no-orphan rule). Run FIRST so the
 *      file is gone even if the defaults write below were to fail.
 *   2. setSettings({ ...DEFAULT_SETTINGS }) — a FULL patch of the verbatim UWP
 *      defaults. Riding the normal setSettings path buys everything for free:
 *      atomic persist, the EvtSettingsChanged broadcast to every window (the
 *      UI reflects defaults live, no restart), and the openWithContextMenu
 *      side-effect (the patch contains the key, so applyContextMenu(false)
 *      removes the Explorer entry if it was on). Settings that the app's
 *      existing convention applies on restart only (appLanguage) keep that
 *      convention — the pane already shows the restart prompt string.
 *
 * There is no renderer-side persisted state outside this store (no
 * localStorage; session snapshots are content, not settings), so resetting the
 * MAIN store + wallpaper file IS the complete factory reset.
 *
 * The default export path injects the real deps; the parameter exists so the
 * order/composition is unit-testable without electron (vitest convention: the
 * electron-touching internals of both deps stay e2e-covered).
 */

import type { Result, Settings } from '../shared/ipc-contract.js';
import { DEFAULT_SETTINGS } from '../shared/ipc-contract.js';
import { setSettings } from './settings.js';
import { clearWallpaper } from './wallpaper.js';

/** Injectable seams (production wiring below; mocks in the unit test). */
export interface ResetDeps {
  clearWallpaper(): Promise<Result<void>>;
  setSettings(patch: Partial<Settings>): Promise<Result<Settings>>;
}

const PROD_DEPS: ResetDeps = { clearWallpaper, setSettings };

/**
 * Restore every persisted setting to its verbatim default and delete the
 * managed wallpaper file. Returns the authoritative merged defaults (identical
 * to what every window receives via EvtSettingsChanged).
 */
export async function resetAllSettings(deps: ResetDeps = PROD_DEPS): Promise<Result<Settings>> {
  // 1) Wallpaper first: clearWallpaper owns BOTH the setting flip and the
  //    managed-file deletion — never duplicate that lifecycle here.
  const cleared = await deps.clearWallpaper();
  if (!cleared.ok) return cleared;
  // 2) Full-defaults patch through the normal settings path (atomic write +
  //    broadcast + context-menu side-effect). Spread so deepMerge never aliases
  //    the shared DEFAULT_SETTINGS object.
  return deps.setSettings({ ...DEFAULT_SETTINGS });
}
