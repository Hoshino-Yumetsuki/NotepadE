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
import {
  planCompactEnter,
  planCompactLeave,
  type CompactSnapshot,
  type WindowAction,
  type WindowFlags,
} from './compact-overlay.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolve the BrowserWindow that owns the calling renderer (IPC event.sender). */
function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Remembered pre-compact snapshot per window, so leaving compact restores it. */
const priorState = new WeakMap<BrowserWindow, CompactSnapshot>();

/** Read the live flags the compact planner snapshots/normalizes from. */
function readFlags(win: BrowserWindow): WindowFlags {
  const b = win.getBounds();
  return {
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
    alwaysOnTop: win.isAlwaysOnTop(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
  };
}

/** Apply the planner's declarative actions to a real BrowserWindow, in order. */
function applyActions(win: BrowserWindow, actions: WindowAction[]): void {
  for (const a of actions) {
    switch (a.type) {
      case 'setFullScreen':
        win.setFullScreen(a.value);
        break;
      case 'unmaximize':
        win.unmaximize();
        break;
      case 'maximize':
        win.maximize();
        break;
      case 'setAlwaysOnTop':
        win.setAlwaysOnTop(a.value, 'floating');
        break;
      case 'setSize':
        win.setSize(a.width, a.height, true);
        break;
      case 'setBounds':
        win.setBounds(a.bounds, true);
        break;
    }
  }
}

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
 * bounds + flags (including maximized/fullscreen), normalizes the window out of
 * maximize/fullscreen, then makes it small + always-on-top. Leaving restores the
 * snapshot EXACTLY, re-applying maximize/fullscreen if they were set. Idempotent:
 * re-entering while compact re-uses the original snapshot, and leaving when not
 * compact is a no-op. The decision logic lives in compact-overlay.ts (pure +
 * unit-tested); this shell only reads live flags and applies the planned actions.
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
      const { snapshot, actions } = planCompactEnter(readFlags(win));
      priorState.set(win, snapshot);
      applyActions(win, actions);
      return { ok: true, data: { isCompactOverlay: true } };
    }
    if (!enabled && isCompact) {
      const snapshot = priorState.get(win)!;
      priorState.delete(win);
      applyActions(win, planCompactLeave(snapshot));
      return { ok: true, data: { isCompactOverlay: false } };
    }
    // Already in the requested state.
    return { ok: true, data: { isCompactOverlay: enabled } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
