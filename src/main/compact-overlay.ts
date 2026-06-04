/**
 * Compact-overlay state machine — MAIN, PURE (Phase 7, Task #30).
 *
 * UWP's CompactOverlay ApplicationView has no Electron equivalent (0.A sign-off
 * #8), so it is substituted with a frameless-style always-on-top shrunk window.
 * The tricky part is RESTORE correctness: a window can be maximized or fullscreen
 * when the user hits F12, and naively `setSize`-ing a maximized/fullscreen window
 * fights the OS window state, so leaving compact lands in the wrong place.
 *
 * This module owns ONLY the decision logic as plain data — given the window's
 * current flags, what to snapshot and which actions to apply on enter, and given
 * a snapshot, which actions restore it on leave. It imports NO electron, so it is
 * unit-testable under vitest like argv-parse.ts / searchUrl.ts (the existing pure
 * main-test convention). window.ts is the thin shell that reads the live flags,
 * calls these planners, and applies the returned actions to the real
 * BrowserWindow.
 */

/** UWP CompactOverlay default view size. */
export const COMPACT_WIDTH = 500;
export const COMPACT_HEIGHT = 360;

/** A rectangle (mirror of Electron.Rectangle; kept local to stay electron-free). */
export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The live window flags the enter-planner needs to snapshot + normalize from. */
export interface WindowFlags {
  bounds: WindowRect;
  alwaysOnTop: boolean;
  maximized: boolean;
  fullScreen: boolean;
}

/**
 * The pre-compact snapshot, persisted per-window while compact, so leaving
 * restores the window EXACTLY — including a maximized/fullscreen state that we
 * had to clear in order to shrink.
 */
export interface CompactSnapshot {
  bounds: WindowRect;
  alwaysOnTop: boolean;
  wasMaximized: boolean;
  wasFullScreen: boolean;
}

/**
 * Declarative actions the shell applies to the BrowserWindow, in array order.
 * Keeping these as data (not direct electron calls) is what makes the planner
 * pure + testable; order matters (e.g. exit fullscreen BEFORE resizing).
 */
export type WindowAction =
  | { type: 'setFullScreen'; value: boolean }
  | { type: 'unmaximize' }
  | { type: 'maximize' }
  | { type: 'setAlwaysOnTop'; value: boolean }
  | { type: 'setSize'; width: number; height: number }
  | { type: 'setBounds'; bounds: WindowRect };

export interface CompactEnterPlan {
  snapshot: CompactSnapshot;
  actions: WindowAction[];
}

/**
 * Plan entering compact overlay from the current window flags. We snapshot the
 * maximized/fullscreen state too, then CLEAR them (fullscreen first, then
 * unmaximize) before going always-on-top + shrinking, so the shrink is not
 * fighting an OS maximize/fullscreen. The snapshot keeps the pre-maximize
 * `bounds` (Electron reports the restored bounds even while maximized), so leave
 * can put the window back precisely.
 */
export function planCompactEnter(current: WindowFlags): CompactEnterPlan {
  const snapshot: CompactSnapshot = {
    bounds: current.bounds,
    alwaysOnTop: current.alwaysOnTop,
    wasMaximized: current.maximized,
    wasFullScreen: current.fullScreen,
  };
  const actions: WindowAction[] = [];
  // Clear fullscreen FIRST — resizing a fullscreen window is a no-op on Windows.
  if (current.fullScreen) actions.push({ type: 'setFullScreen', value: false });
  if (current.maximized) actions.push({ type: 'unmaximize' });
  actions.push({ type: 'setAlwaysOnTop', value: true });
  actions.push({ type: 'setSize', width: COMPACT_WIDTH, height: COMPACT_HEIGHT });
  return { snapshot, actions };
}

/**
 * Plan leaving compact overlay back to a snapshot. Restore order is the inverse:
 * drop always-on-top, restore the bounds, then re-apply maximize/fullscreen if
 * the window had them. Restoring bounds BEFORE re-maximizing means an unmaximize
 * later lands on the right pre-compact rectangle.
 */
export function planCompactLeave(snapshot: CompactSnapshot): WindowAction[] {
  const actions: WindowAction[] = [];
  actions.push({ type: 'setAlwaysOnTop', value: snapshot.alwaysOnTop });
  actions.push({ type: 'setBounds', bounds: snapshot.bounds });
  if (snapshot.wasMaximized) actions.push({ type: 'maximize' });
  if (snapshot.wasFullScreen) actions.push({ type: 'setFullScreen', value: true });
  return actions;
}

/**
 * The window operations the stateful toggle driver needs, abstracted so the
 * driver (and its idempotent guard) is unit-testable without electron. window.ts
 * supplies a thin adapter over the real BrowserWindow; tests supply a fake.
 */
export interface CompactWindowPort {
  /** Read the window's current flags (bounds + alwaysOnTop/maximized/fullScreen). */
  readFlags(): WindowFlags;
  /** Apply the planner's declarative actions to the window, in order. */
  apply(actions: WindowAction[]): void;
}

/**
 * Per-window compact state. Holds the pre-compact snapshot while compact, or null
 * when normal. window.ts keeps one of these per BrowserWindow (in a WeakMap); the
 * driver reads/writes it so the guard logic stays here, pure and tested.
 */
export interface CompactState {
  snapshot: CompactSnapshot | null;
}

/** Fresh state for a window that has never entered compact. */
export function createCompactState(): CompactState {
  return { snapshot: null };
}

/**
 * Drive a compact-overlay toggle against a window port, mutating `state`.
 * Idempotent by the `state.snapshot` guard: entering when already compact, or
 * leaving when already normal, applies NOTHING and preserves the original
 * snapshot — so a maximized window that gets a redundant F12 still restores to
 * maximized on the real leave. Returns the resolved compact flag.
 */
export function toggleCompact(
  port: CompactWindowPort,
  state: CompactState,
  enabled: boolean,
): { isCompactOverlay: boolean } {
  const isCompact = state.snapshot !== null;
  if (enabled && !isCompact) {
    const { snapshot, actions } = planCompactEnter(port.readFlags());
    state.snapshot = snapshot;
    port.apply(actions);
    return { isCompactOverlay: true };
  }
  if (!enabled && isCompact) {
    const snapshot = state.snapshot!;
    state.snapshot = null;
    port.apply(planCompactLeave(snapshot));
    return { isCompactOverlay: false };
  }
  // Already in the requested state — no-op.
  return { isCompactOverlay: enabled };
}
