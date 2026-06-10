/**
 * useWallpaper — the renderer's live binding to MAIN's managed wallpaper.
 *
 * Mirrors useSettings' shape: the hook resolves the active wallpaper image to a
 * `data:` URL via window.notepads.wallpaper.get(). It re-fetches whenever the
 * persisted `settings.wallpaperFileName` changes — set/replace/clear all flow
 * through MAIN's settings store, which broadcasts EvtSettingsChanged to EVERY
 * window (this one and any other), so the file name in the settings bag is the
 * single change signal and no dedicated wallpaper push channel is needed. The
 * timestamped managed file name (wallpaper-<ms>.<ext>) guarantees a replace
 * always changes the name, so this effect can never miss a swap.
 *
 * PA-8: consumes ONLY window.notepads.wallpaper — no fs/path here; MAIN reads
 * the file and encodes the data URL.
 */

import { useEffect, useState } from 'react';

/**
 * Resolve `wallpaperFileName` (from the live settings bag) to a displayable
 * data URL, or null while loading / when no wallpaper is set / when the file
 * vanished underneath the setting (MAIN resolves that to the empty state).
 */
export function useWallpaper(wallpaperFileName: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fast path: nothing persisted — skip the IPC round-trip entirely.
    if (wallpaperFileName === '') {
      setDataUrl(null);
      return;
    }
    let alive = true;
    void window.notepads.wallpaper.get().then((r) => {
      // Guard against unmount AND against a stale resolve racing a rapid
      // replace (the effect for the newer file name re-runs and wins).
      if (alive) setDataUrl(r.ok ? r.data.dataUrl : null);
    });
    return () => {
      alive = false;
    };
  }, [wallpaperFileName]);

  return dataUrl;
}
