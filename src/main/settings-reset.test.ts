/**
 * Reset-all-settings unit tests — MAIN, electron-free.
 *
 * resetAllSettings composes two existing owners (wallpaper clear + settings
 * full-defaults patch); the deps are injected so the COMPOSITION rules are
 * testable without electron (the deps' own internals are covered by
 * wallpaper.test.ts / the settings e2e):
 *   - wallpaper cleanup runs FIRST and via clearWallpaper ONLY (the single
 *     owner of the managed-file deletion — never a duplicated delete),
 *   - the settings patch is the FULL verbatim DEFAULT_SETTINGS bag (every key
 *     present, so deepMerge restores everything in one atomic write),
 *   - a failed wallpaper clear aborts the reset (no half-reset state),
 *   - the patch is a COPY (mutating it downstream must not poison the shared
 *     DEFAULT_SETTINGS constant).
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Result, type Settings } from '../shared/ipc-contract';
import { resetAllSettings, type ResetDeps } from './settings-reset';

function okDeps(): ResetDeps & {
  clearWallpaper: ReturnType<typeof vi.fn>;
  setSettings: ReturnType<typeof vi.fn>;
} {
  return {
    clearWallpaper: vi.fn().mockResolvedValue({ ok: true, data: undefined } as Result<void>),
    setSettings: vi
      .fn()
      .mockImplementation((patch: Partial<Settings>) =>
        Promise.resolve({ ok: true, data: { ...DEFAULT_SETTINGS, ...patch } } as Result<Settings>)
      )
  };
}

describe('resetAllSettings', () => {
  it('clears the wallpaper THEN writes the full defaults bag', async () => {
    const deps = okDeps();
    const order: string[] = [];
    deps.clearWallpaper.mockImplementation(() => {
      order.push('clearWallpaper');
      return Promise.resolve({ ok: true, data: undefined });
    });
    deps.setSettings.mockImplementation((patch: Partial<Settings>) => {
      order.push('setSettings');
      return Promise.resolve({ ok: true, data: { ...DEFAULT_SETTINGS, ...patch } });
    });

    const r = await resetAllSettings(deps);
    expect(r.ok).toBe(true);
    // Wallpaper-file deletion is delegated to its single owner, exactly once,
    // and BEFORE the defaults write.
    expect(order).toEqual(['clearWallpaper', 'setSettings']);
  });

  it('patches EVERY settings key with its verbatim default', async () => {
    const deps = okDeps();
    await resetAllSettings(deps);
    const patch = deps.setSettings.mock.calls[0][0] as Partial<Settings>;
    // Full bag: deepMerge only considers keys present in the patch, so a
    // partial patch would silently leave fields un-reset.
    expect(patch).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(patch).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    // Includes the wallpaper field (clearWallpaper already flipped it, but the
    // defaults bag re-asserting '' keeps the write idempotent).
    expect(patch.wallpaperFileName).toBe('');
  });

  it('hands setSettings a COPY, never the shared DEFAULT_SETTINGS object', async () => {
    const deps = okDeps();
    await resetAllSettings(deps);
    const patch = deps.setSettings.mock.calls[0][0] as Partial<Settings>;
    expect(patch).not.toBe(DEFAULT_SETTINGS);
  });

  it('aborts (no settings write) when the wallpaper clear fails', async () => {
    const deps = okDeps();
    deps.clearWallpaper.mockResolvedValue({ ok: false, error: 'disk locked' });
    const r = await resetAllSettings(deps);
    expect(r).toEqual({ ok: false, error: 'disk locked' });
    expect(deps.setSettings).not.toHaveBeenCalled();
  });

  it('returns the authoritative merged defaults from the settings path', async () => {
    const deps = okDeps();
    const r = await resetAllSettings(deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(DEFAULT_SETTINGS);
  });
});
