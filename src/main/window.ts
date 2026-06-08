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

import { app, BrowserWindow } from 'electron';
import type { Result } from '../shared/ipc-contract.js';
import { IpcChannels } from '../shared/ipc-channels.js';
import { brokerRequest as brokerRequestImpl } from './broker.js';
import {
  toggleCompact,
  createCompactState,
  windowStateFrom,
  type CompactState,
  type CompactWindowPort,
  type WindowAction,
  type WindowState
} from './compact-overlay.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolve the BrowserWindow that owns the calling renderer (IPC event.sender). */
function windowFor(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * Custom caption controls (replace the OS titleBarOverlay). The renderer's
 * in-chrome min/max/close buttons drive these so the buttons themselves are
 * transparent and the window acrylic shows through — 1:1 with the UWP
 * ApplyThemeForTitleBarButtons transparent-button scheme. Each acts on the window
 * that OWNS the calling renderer (PA-8: no windowId from the renderer).
 */
export function windowMinimize(event: Electron.IpcMainInvokeEvent): Result<void> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    win.minimize();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Toggle maximize/restore; resolves with the resulting maximized flag. */
export function windowToggleMaximize(
  event: Electron.IpcMainInvokeEvent
): Result<{ isMaximized: boolean }> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, data: { isMaximized: win.isMaximized() } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export function windowClose(event: Electron.IpcMainInvokeEvent): Result<void> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    win.close();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Windows whose close has been confirmed by the renderer's close-reminder flow.
 * The 'close' guard in window-factory consults this set: a window NOT present is
 * intercepted (preventDefault + EvtWindowCloseRequested push); a window present is
 * allowed to close for real. Mirrors the UWP deferral: the dialog resolves, then
 * `deferral.Complete()` lets the navigation proceed.
 */
const confirmedClose = new WeakSet<BrowserWindow>();

/**
 * Global "the app is quitting" flag. Set on `before-quit` so the close guard stops
 * intercepting — an explicit app quit (exit-when-last-tab, window-all-closed, OS
 * shutdown) must not be blocked per-window. The renderer's own quit path already
 * ran the unsaved-changes flow before calling `window.quit()`.
 */
let appQuitting = false;

/** Register the before-quit hook that disarms the per-window close guard. */
export function initCloseGuardQuitBypass(): void {
  app.on('before-quit', () => {
    appQuitting = true;
  });
}

/** True when this window's close has already been confirmed (window-factory guard). */
export function isCloseConfirmed(win: BrowserWindow): boolean {
  return confirmedClose.has(win);
}

/**
 * The renderer finished its unsaved-changes flow and the window may now close.
 * Mark it confirmed (so the factory's 'close' guard lets it through) and trigger
 * the real close. 1:1 with UWP `deferral.Complete()` after the close dialog.
 */
export function windowConfirmClose(event: Electron.IpcMainInvokeEvent): Result<void> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    confirmedClose.add(win);
    win.close();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Install the close guard on a freshly-created window. Until the renderer confirms
 * (window.confirmClose → confirmedClose set), every native close attempt (X /
 * Alt+F4 / OS) is intercepted and forwarded to the renderer as a close-request so
 * it can run the unsaved-changes flow (UWP MainPage_CloseRequested). Called by the
 * window factory.
 */
export function installCloseGuard(win: BrowserWindow): void {
  win.on('close', (e) => {
    if (appQuitting) return; // app-level quit — never block.
    if (confirmedClose.has(win)) return; // confirmed — let it close.
    if (win.webContents.isDestroyed()) return; // nothing to ask; allow.
    e.preventDefault();
    win.webContents.send(IpcChannels.EvtWindowCloseRequested);
  });
}

/** Current maximized flag — seeds the renderer's restore glyph on mount. */
export function windowIsMaximized(
  event: Electron.IpcMainInvokeEvent
): Result<{ isMaximized: boolean }> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    return { ok: true, data: { isMaximized: win.isMaximized() } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Remembered per-window compact state, so leaving compact restores the snapshot. */
const compactState = new WeakMap<BrowserWindow, CompactState>();

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

/** Adapt a real BrowserWindow to the pure compact driver's window port. */
function compactPort(win: BrowserWindow): CompactWindowPort {
  return {
    readFlags: () => {
      const b = win.getBounds();
      return {
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
        alwaysOnTop: win.isAlwaysOnTop(),
        maximized: win.isMaximized(),
        fullScreen: win.isFullScreen()
      };
    },
    apply: (actions) => applyActions(win, actions)
  };
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
  enabled: boolean
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
  enabled: boolean
): Result<{ isCompactOverlay: boolean }> {
  const win = windowFor(event);
  if (!win) return { ok: false, error: 'No window for this renderer' };
  try {
    let state = compactState.get(win);
    if (!state) {
      state = createCompactState();
      compactState.set(win, state);
    }
    const { isCompactOverlay } = toggleCompact(compactPort(win), state, enabled);
    return { ok: true, data: { isCompactOverlay } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Quit the whole application (UWP ExitApp). Invoked by the renderer when the last
 * tab is closed and `settings.exitWhenLastTabClosed` is on. MAIN owns the app
 * lifecycle; `app.quit()` runs the normal close path (window-all-closed → quit).
 */
export function windowQuit(): Result<void> {
  try {
    app.quit();
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------------------
//  MAIN test seam (NOTEPADS_E2E only) — window state reader
// ---------------------------------------------------------------------------

/** Resolve the window the e2e harness is asserting: focused, else first live. */
function primaryWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

/** True when the window is currently in the compact-overlay substitute state. */
function isCompact(win: BrowserWindow): boolean {
  return compactState.get(win)?.snapshot != null;
}

/**
 * Read the primary window's live state for the Gate-7 compact behavior matrix:
 * the real bounds/alwaysOnTop/maximize/fullscreen flags plus our compact-state
 * truth, shaped by the pure `windowStateFrom`. Returns null if no live window
 * exists. Exported so `installWindowTestSeam` can expose it; never wired into the
 * production IPC surface (it reads from the same `compactState` the real toggle
 * mutates, so it reflects genuine state, not emulation).
 */
export function readWindowStateForTest(): WindowState | null {
  const win = primaryWindow();
  if (!win) return null;
  return windowStateFrom(compactPort(win).readFlags(), isCompact(win));
}

/**
 * Augment the shared `globalThis.__notepadsMainTest` seam (installed by the
 * broker) with `readWindowState`, gated on NOTEPADS_E2E so it never widens the
 * production surface. Call once from bootstrap AFTER `installMainTestSeam` so the
 * base object already exists; if it doesn't (defensive), create it.
 */
export function installWindowTestSeam(): void {
  if (process.env['NOTEPADS_E2E'] !== '1') return;
  const g = globalThis as unknown as {
    __notepadsMainTest?: { readWindowState?: () => WindowState | null };
  };
  const seam = (g.__notepadsMainTest ??= {});
  seam.readWindowState = readWindowStateForTest;
}
