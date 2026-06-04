/**
 * Window operations — MAIN only (Phase 6, Workstream 6.A).
 *
 * Implements the frozen WindowApi: brokerRequest (redirect-vs-spawn delegated to
 * the broker), setFullScreen, and setCompactOverlay. Each handler acts on the
 * BrowserWindow that OWNS the calling renderer (resolved from the IPC
 * `event.sender`), never a windowId passed up from the renderer (PA-8: the
 * renderer has no window identity).
 *
 * Compact overlay (0.A sign-off #8): UWP's CompactOverlay ApplicationView mode
 * has no direct Electron equivalent, so it is substituted with a frameless,
 * always-on-top, shrunk window — entering remembers the prior bounds/flags so
 * leaving restores them exactly.
 */

import { BrowserWindow } from 'electron';
import type { Result } from '../shared/ipc-contract.js';
import { brokerRequest as brokerRequestImpl } from './broker.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolve the BrowserWindow that owns the calling renderer (IPC event.sender). */
function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Remembered pre-compact state per window, so leaving compact restores it. */
interface PriorWindowState {
  bounds: Electron.Rectangle;
  alwaysOnTop: boolean;
  /** The compact-overlay target size (UWP CompactOverlay default ~500x360). */
}
const priorState = new WeakMap<BrowserWindow, PriorWindowState>();

/** UWP CompactOverlay default view size. */
const COMPACT_WIDTH = 500;
const COMPACT_HEIGHT = 360;

/**
 * Ask the broker to open paths (redirect into the focused window or spawn a new
 * one per AlwaysOpenNewWindow / forceNewWindow). The renderer never decides
 * which window; the broker is the sole router.
 */
export async function windowBrokerRequest(args: {
  paths: string[];
  forceNewWindow?: boolean;
}): Promise<Result<void>> {
  try {
    await brokerRequestImpl(args.paths, args.forceNewWindow ?? false);
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Toggle native fullscreen on the calling window; reports the resolved flag. */
export function windowSetFullScreen(
  event: Electron.IpcMainInvokeEvent,
  enabled: boolean,
): Result<{ isFullScreen: boolean }> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    win.setFullScreen(enabled);
    return { ok: true, data: { isFullScreen: win.isFullScreen() } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Enter/leave the compact-overlay substitute. Entering snapshots the current
 * bounds + always-on-top flag, then makes the window small + always-on-top.
 * Leaving restores the snapshot. Idempotent: re-entering while compact re-uses
 * the original snapshot, and leaving when not compact is a no-op.
 */
export function windowSetCompactOverlay(
  event: Electron.IpcMainInvokeEvent,
  enabled: boolean,
): Result<{ isCompactOverlay: boolean }> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    const isCompact = priorState.has(win);
    if (enabled && !isCompact) {
      priorState.set(win, { bounds: win.getBounds(), alwaysOnTop: win.isAlwaysOnTop() });
      win.setAlwaysOnTop(true, 'floating');
      win.setSize(COMPACT_WIDTH, COMPACT_HEIGHT, true);
      return { ok: true, data: { isCompactOverlay: true } };
    }
    if (!enabled && isCompact) {
      const prior = priorState.get(win)!;
      priorState.delete(win);
      win.setAlwaysOnTop(prior.alwaysOnTop);
      win.setBounds(prior.bounds, true);
      return { ok: true, data: { isCompactOverlay: false } };
    }
    // Already in the requested state.
    return { ok: true, data: { isCompactOverlay: enabled } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
