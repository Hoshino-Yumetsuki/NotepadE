/**
 * Window bounds persistence — MAIN only.
 *
 * UWP got window size/placement restoration from the OS shell for free. Electron
 * does not, so the rewrite would otherwise open every window at a fixed
 * 1100×720 — a behavior regression. This module persists the last window
 * bounds + maximized flag to `WindowBounds.json` in userData and restores them on
 * the next launch (clamped to a currently-connected display so a window saved on a
 * now-disconnected monitor never opens off-screen).
 *
 * Mirrors settings.ts: atomic write (tmp + rename), e2e-userData-override aware.
 * The renderer NEVER touches fs/path — bounds are handled entirely here (PA-8).
 *
 * Determinism: under the e2e harness (NOTEPADS_E2E=1) restore + persist are
 * DISABLED so every spec launches at the fixed default size (visual goldens and
 * layout assertions depend on it).
 */

import { writeFile, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';

/** Persisted shape. All fields optional-safe; a partial/corrupt file is ignored. */
export interface PersistedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/** Default window size (the historical hardcoded values from window-factory). */
export const DEFAULT_BOUNDS = { width: 1100, height: 720 } as const;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;

const BOUNDS_FILE_NAME = 'WindowBounds.json';

function isE2e(): boolean {
  return process.env['NOTEPADS_E2E'] === '1';
}

function userDataRoot(): string {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) return override;
  return app.getPath('userData');
}

function boundsFilePath(): string {
  return join(userDataRoot(), BOUNDS_FILE_NAME);
}

// ---------------------------------------------------------------------------
//  Pure geometry helpers (unit-tested without Electron)
// ---------------------------------------------------------------------------

/** A rectangle of a display work area, for the clamp computation. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isFiniteRect(b: Partial<PersistedBounds> | null | undefined): b is PersistedBounds {
  return (
    b != null &&
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height)
  );
}

/**
 * Decide the bounds to open with, given the saved record and the available
 * display work areas. Returns null (→ caller uses centered default) when there is
 * no usable saved record. Otherwise clamps the size to >= the minimums and ensures
 * the window's top-left sits inside SOME work area (so a window saved on a
 * disconnected monitor is pulled back on-screen). Pure: no Electron, no fs.
 */
export function resolveBounds(
  saved: Partial<PersistedBounds> | null | undefined,
  workAreas: WorkArea[]
): PersistedBounds | null {
  if (!isFiniteRect(saved)) return null;
  const width = Math.max(MIN_WIDTH, Math.floor(saved.width));
  const height = Math.max(MIN_HEIGHT, Math.floor(saved.height));
  const x = Math.floor(saved.x);
  const y = Math.floor(saved.y);
  const isMaximized = saved.isMaximized === true;

  // On-screen test: the top-left corner must lie within some display's work area.
  const onScreen = workAreas.some(
    (wa) => x >= wa.x && x < wa.x + wa.width && y >= wa.y && y < wa.y + wa.height
  );
  if (onScreen || workAreas.length === 0) {
    return { x, y, width, height, isMaximized };
  }
  // Off-screen: drop the stale position, keep the size (caller centers it).
  return { x: Number.NaN, y: Number.NaN, width, height, isMaximized };
}

/** Serialize bounds to the on-disk JSON form. Pure. */
export function serializeBounds(b: PersistedBounds): string {
  return JSON.stringify(b, null, 2);
}

// ---------------------------------------------------------------------------
//  Disk IO + BrowserWindow wiring
// ---------------------------------------------------------------------------

/** Read the saved bounds (null on missing/corrupt/unreadable). Never throws. */
async function readSavedBounds(): Promise<PersistedBounds | null> {
  try {
    const raw = await readFile(boundsFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedBounds>;
    return isFiniteRect(parsed)
      ? {
          x: parsed.x,
          y: parsed.y,
          width: parsed.width,
          height: parsed.height,
          isMaximized: parsed.isMaximized === true
        }
      : null;
  } catch {
    return null;
  }
}

/** Current display work areas (Electron screen API). */
function currentWorkAreas(): WorkArea[] {
  try {
    return screen.getAllDisplays().map((d) => ({
      x: d.workArea.x,
      y: d.workArea.y,
      width: d.workArea.width,
      height: d.workArea.height
    }));
  } catch {
    return [];
  }
}

/**
 * Compute the BrowserWindow bounds for a restored window, or null when the window
 * should open at its constructor default with NO resize (e2e determinism + first
 * run). Returning null lets the factory keep its original `show()`-only path so the
 * default-sized window is pixel-identical to the pre-bounds behavior (the visual
 * goldens depend on this). `restoreMaximized` tells the caller to maximize on show.
 */
export async function restoredWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
  restoreMaximized: boolean;
} | null> {
  if (isE2e()) return null;
  const resolved = resolveBounds(await readSavedBounds(), currentWorkAreas());
  if (!resolved) return null;
  const base = { width: resolved.width, height: resolved.height };
  // NaN x/y means "size only, center it" (stale off-screen position dropped).
  if (Number.isFinite(resolved.x) && Number.isFinite(resolved.y)) {
    return { ...base, x: resolved.x, y: resolved.y, restoreMaximized: resolved.isMaximized };
  }
  return { ...base, restoreMaximized: resolved.isMaximized };
}

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

/** Persist a window's current bounds. Best-effort; never throws. No-op under e2e. */
async function persistBounds(win: BrowserWindow): Promise<void> {
  if (isE2e() || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    // When maximized/fullscreen, getBounds returns the maximized rect; persist the
    // NORMAL bounds (getNormalBounds) so un-maximizing on next launch restores the
    // user's chosen size, with the maximized flag re-applied on top.
    const b = isMaximized || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    await writeAtomic(
      boundsFilePath(),
      serializeBounds({ x: b.x, y: b.y, width: b.width, height: b.height, isMaximized })
    );
  } catch {
    // Bounds persistence is best-effort; never surface.
  }
}

/**
 * Track a window's geometry: debounced persist on resize/move, immediate persist on
 * maximize/unmaximize and close. No-op under e2e (deterministic fixed size). Call
 * once per window from the factory AFTER restoring bounds.
 */
export function trackWindowBounds(win: BrowserWindow): void {
  if (isE2e()) return;
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persistBounds(win);
    }, 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', () => void persistBounds(win));
  win.on('unmaximize', () => void persistBounds(win));
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    void persistBounds(win);
  });
}
