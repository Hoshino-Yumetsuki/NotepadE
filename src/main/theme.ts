/**
 * OS theme + accent — MAIN only (Phase 5).
 *
 * Replaces the parts of the UWP `ThemeSettingsService` that read the *system*
 * theme/accent (as opposed to the user's stored preference, which lives in
 * settings.ts). MAIN is the sole reader of Electron's `nativeTheme` and
 * `systemPreferences`:
 *   - `getThemeState()` resolves the current OS theme ('dark' when
 *     `nativeTheme.shouldUseDarkColors`, else 'light'), the high-contrast flag,
 *     and the system accent color normalized to `#RRGGBB`.
 *   - `initThemePush()` subscribes to `nativeTheme`'s 'updated' event and (on
 *     Windows/macOS) `systemPreferences`' 'accent-color-changed' event, pushing
 *     `EvtThemeOsChanged` / `EvtThemeAccentChanged` to every renderer so the
 *     Fluent token layer re-themes live.
 *
 * The renderer NEVER reads nativeTheme/systemPreferences directly (PA-8); it
 * consumes the typed `window.notepads.theme` surface and the push events.
 */

import { BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import type { Result, ThemeState } from '../shared/ipc-contract.js';
import { IpcChannels } from '../shared/ipc-channels.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolved OS theme from nativeTheme: dark when dark colors are in effect. */
function resolveOsTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/**
 * Normalize an accent color to `#RRGGBB`. `systemPreferences.getAccentColor()`
 * returns an 8-digit `RRGGBBAA` string on Windows; the contract wants opaque
 * `#RRGGBB`, so we drop any alpha and prefix '#'. An empty/odd value falls back
 * to a neutral accent so the renderer always gets a valid 7-char hex.
 */
function normalizeAccent(raw: string): string {
  const hex = raw.replace(/^#/, '');
  if (hex.length >= 6) {
    return `#${hex.slice(0, 6).toUpperCase()}`;
  }
  return '#0078D4'; // Windows default accent; only hit if the OS returns nothing.
}

function readAccentColor(): string {
  try {
    return normalizeAccent(systemPreferences.getAccentColor());
  } catch {
    return '#0078D4';
  }
}

/** Read the current OS theme state (theme + high-contrast + accent). */
export function getThemeState(): Result<ThemeState> {
  try {
    return {
      ok: true,
      data: {
        osTheme: resolveOsTheme(),
        accentColor: readAccentColor(),
        highContrast: nativeTheme.shouldUseHighContrastColors
      }
    };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * Wire the live OS theme/accent pushes. Called once at MAIN startup (alongside
 * registerIpcHandlers). `nativeTheme` 'updated' fires for both light/dark and
 * high-contrast transitions; the accent event is win32/macOS only, so its
 * registration is guarded.
 */
export function initThemePush(): void {
  nativeTheme.on('updated', () => {
    broadcast(IpcChannels.EvtThemeOsChanged, resolveOsTheme());
  });

  if (process.platform === 'win32' || process.platform === 'darwin') {
    systemPreferences.on('accent-color-changed', (_event, newColor: string) => {
      broadcast(IpcChannels.EvtThemeAccentChanged, normalizeAccent(newColor));
    });
  }
}
