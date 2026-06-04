/**
 * useSettings — the renderer's live binding to the MAIN-owned settings store.
 *
 * Reads the full bag once via window.notepads.settings.get(), keeps it current
 * via window.notepads.settings.onChanged (fires for this window AND any other
 * window / external write), and patches fields via window.notepads.settings.set.
 *
 * Every settings control reads `settings[field]` for its value and calls
 * `update({ field })` on change; the optimistic local apply makes the control
 * feel instant while MAIN persists + broadcasts the authoritative merged bag,
 * which then arrives via onChanged and reconciles.
 *
 * PA-8: consumes ONLY window.notepads.settings — no fs/path/child_process.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Settings } from '@shared/ipc-contract';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';

export interface UseSettingsResult {
  /** The current settings bag (defaults until the first get()/onChanged). */
  settings: Settings;
  /** Patch one or more fields: optimistic local apply + persist via MAIN. */
  update(patch: Partial<Settings>): void;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let alive = true;
    void window.notepads.settings.get().then((r) => {
      if (alive && r.ok) setSettings(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => window.notepads.settings.onChanged((s) => setSettings(s)), []);

  const update = useCallback((patch: Partial<Settings>): void => {
    // Optimistic local apply so the control reflects the change immediately; the
    // authoritative merged bag arrives via onChanged and reconciles.
    setSettings((prev) => ({ ...prev, ...patch }));
    void window.notepads.settings.set(patch).then((r) => {
      if (r.ok) setSettings(r.data);
    });
  }, []);

  return { settings, update };
}
