/**
 * Settings persistence — MAIN only.
 *
 * Replaces the UWP `ApplicationSettingsStore` / `AppSettingsService` /
 * `ThemeSettingsService` persistence layer with a single JSON file,
 * `Settings.json`, in the app's userData root. MAIN is the authority:
 *   - `getSettings()` reads the file and DEEP-MERGES it over `DEFAULT_SETTINGS`
 *     (the verbatim UWP defaults imported from the frozen contract), so any
 *     absent key falls back to its UWP default. A corrupt/unreadable file is
 *     treated as "no settings yet" and yields `DEFAULT_SETTINGS` (never throws).
 *   - `setSettings(patch)` merges the patch over the current settings, clamps a
 *     few obviously-bounded numeric fields, writes the result ATOMICALLY
 *     (tmp file + rename, like file-io's save path), then BROADCASTS
 *     `EvtSettingsChanged` with the merged settings to every BrowserWindow so all
 *     renderers stay live (mirrors UWP's settings-changed eventing).
 *
 * The renderer NEVER touches fs/path — all of this lives behind IPC (PA-8). The
 * e2e userData override (`NOTEPADS_E2E_USERDATA`) is honored exactly as in
 * session.ts / index.ts so a scripted restart reads the same Settings.json.
 */

import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { Result, Settings } from '../shared/ipc-contract.js';
import { DEFAULT_SETTINGS } from '../shared/ipc-contract.js';
import { IpcChannels } from '../shared/ipc-channels.js';
import { applyContextMenu } from './contextMenu.js';

/** Single persisted settings file (UWP used the app-data settings container). */
const SETTINGS_FILE_NAME = 'Settings.json';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Resolve the userData root. Honors the e2e override (`NOTEPADS_E2E_USERDATA`,
 * also applied via `app.setPath` in index.ts) so a scripted restart hits the
 * SAME Settings.json. Falls back to Electron's userData path.
 */
function userDataRoot(): string {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) return override;
  return app.getPath('userData');
}

function settingsFilePath(): string {
  return join(userDataRoot(), SETTINGS_FILE_NAME);
}

/**
 * Deep-merge a (possibly partial / untrusted) parsed object over a base. Only
 * keys present in `base` are considered, so unknown keys from an old/foreign
 * file are dropped and the merged result always conforms to `Settings`. Nested
 * plain objects are merged recursively; everything else is taken from `patch`
 * when present (and of the same primitive shape) else from `base`.
 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    return base;
  }
  const src = patch as Record<string, unknown>;
  const out = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (!(key in src)) continue;
    const baseVal = out[key];
    const patchVal = src[key];
    if (
      baseVal != null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      patchVal != null &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal)
    ) {
      out[key] = deepMerge(baseVal, patchVal);
    } else if (typeof patchVal === typeof baseVal && patchVal != null) {
      out[key] = patchVal;
    }
  }
  return out as T;
}

/**
 * Defensive clamping of the obviously-bounded fields. MAIN stays the authority;
 * this only guards against a hand-edited or stale Settings.json, it is not a
 * full schema validator (the contract types do the heavy lifting at the seams).
 */
function clampSettings(s: Settings): Settings {
  const tintOpacity = Number.isFinite(s.tintOpacity)
    ? Math.min(1, Math.max(0, s.tintOpacity))
    : DEFAULT_SETTINGS.tintOpacity;
  const editorFontSize =
    Number.isFinite(s.editorFontSize) && s.editorFontSize > 0
      ? s.editorFontSize
      : DEFAULT_SETTINGS.editorFontSize;
  const tabIndents = ([-1, 2, 4, 8] as const).includes(s.tabIndents)
    ? s.tabIndents
    : DEFAULT_SETTINGS.tabIndents;
  return { ...s, tintOpacity, editorFontSize, tabIndents };
}

/**
 * Read the persisted settings, applying UWP defaults for any absent key. A
 * missing file (first run) or corrupt JSON both resolve to DEFAULT_SETTINGS —
 * settings reads must never fail the app (UWP silently re-initialized defaults).
 */
export async function getSettings(): Promise<Result<Settings>> {
  try {
    const raw = await readFile(settingsFilePath(), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt JSON -> fall back to verbatim defaults (do not throw).
      return { ok: true, data: { ...DEFAULT_SETTINGS } };
    }
    const merged = clampSettings(deepMerge(DEFAULT_SETTINGS, parsed));
    return { ok: true, data: merged };
  } catch {
    // No file yet (first run) -> verbatim defaults.
    return { ok: true, data: { ...DEFAULT_SETTINGS } };
  }
}

/**
 * Merge `patch` over the current settings, persist atomically, then broadcast
 * the merged settings to every window. The returned value is the authoritative
 * merged-and-clamped Settings, identical to what subscribers receive.
 */
export async function setSettings(patch: Partial<Settings>): Promise<Result<Settings>> {
  try {
    const current = await getSettings();
    // getSettings never returns !ok, but keep the type honest.
    const base = current.ok ? current.data : { ...DEFAULT_SETTINGS };
    const merged = clampSettings(deepMerge(base, patch));
    await writeAtomic(settingsFilePath(), JSON.stringify(merged, null, 2));
    broadcastSettingsChanged(merged);
    if ('openWithContextMenu' in patch) applyContextMenu(merged.openWithContextMenu);
    return { ok: true, data: merged };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Atomic write: serialize to a sibling tmp file then rename over the target, so
 * a crash mid-write can never leave a truncated Settings.json (mirrors file-io's
 * intent). The tmp file is best-effort cleaned up on a failed rename.
 */
async function writeAtomic(targetPath: string, contents: string): Promise<void> {
  const tmpPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, contents, 'utf8');
  try {
    await rename(tmpPath, targetPath);
  } catch (e) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw e;
  }
}

/** Push the merged settings to every renderer (UWP settings-changed eventing). */
function broadcastSettingsChanged(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IpcChannels.EvtSettingsChanged, settings);
    }
  }
}
