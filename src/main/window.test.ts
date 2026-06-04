import { describe, it, expect } from 'vitest';
import {
  toggleCompact,
  createCompactState,
  COMPACT_WIDTH,
  COMPACT_HEIGHT,
  type CompactWindowPort,
  type WindowRect,
} from './compact-overlay';

/**
 * Compact-overlay THIN-SHELL driver (Task #30) — exercises the idempotent guard
 * and the live read→plan→apply round-trip through a FAKE window port, so the
 * stateful toggle is unit-tested electron-free (the pure planners are covered by
 * compact-overlay.test.ts). This is the `window.test.ts` Gate-7 behavior matrix
 * leans on: normal/maximized/fullscreen enter→leave + re-entry no-op.
 *
 * window.ts itself only adapts a real BrowserWindow to CompactWindowPort and
 * resolves the calling window from event.sender — that adapter is electron and
 * stays e2e-covered (vitest has no electron mock, by design).
 */

const RECT: WindowRect = { x: 100, y: 80, width: 1100, height: 720 };

/**
 * A fake BrowserWindow port: records every applied action and reflects the flags
 * back the way a real window would (size shrinks, maximize/fullscreen clear), so
 * a second read after enter sees the compact state — proving the guard, not the
 * port, is what makes re-entry a no-op.
 */
function fakeWindow(initial: Partial<{
  bounds: WindowRect;
  alwaysOnTop: boolean;
  maximized: boolean;
  fullScreen: boolean;
}> = {}): CompactWindowPort & { calls: string[] } {
  let bounds: WindowRect = initial.bounds ?? RECT;
  let alwaysOnTop = initial.alwaysOnTop ?? false;
  let maximized = initial.maximized ?? false;
  let fullScreen = initial.fullScreen ?? false;
  const calls: string[] = [];
  return {
    calls,
    readFlags: () => ({ bounds, alwaysOnTop, maximized, fullScreen }),
    apply: (actions) => {
      for (const a of actions) {
        switch (a.type) {
          case 'setFullScreen':
            fullScreen = a.value;
            calls.push(`setFullScreen:${a.value}`);
            break;
          case 'unmaximize':
            maximized = false;
            calls.push('unmaximize');
            break;
          case 'maximize':
            maximized = true;
            calls.push('maximize');
            break;
          case 'setAlwaysOnTop':
            alwaysOnTop = a.value;
            calls.push(`setAlwaysOnTop:${a.value}`);
            break;
          case 'setSize':
            bounds = { ...bounds, width: a.width, height: a.height };
            calls.push(`setSize:${a.width}x${a.height}`);
            break;
          case 'setBounds':
            bounds = a.bounds;
            calls.push(`setBounds:${a.bounds.width}x${a.bounds.height}`);
            break;
        }
      }
    },
  };
}

describe('toggleCompact', () => {
  it('enters compact from a normal window: always-on-top then shrink', () => {
    const win = fakeWindow();
    const state = createCompactState();
    const res = toggleCompact(win, state, true);
    expect(res.isCompactOverlay).toBe(true);
    expect(win.calls).toEqual([
      'setAlwaysOnTop:true',
      `setSize:${COMPACT_WIDTH}x${COMPACT_HEIGHT}`,
    ]);
  });

  it('round-trips a normal window back to its exact prior bounds', () => {
    const win = fakeWindow();
    const state = createCompactState();
    toggleCompact(win, state, true);
    win.calls.length = 0;
    const res = toggleCompact(win, state, false);
    expect(res.isCompactOverlay).toBe(false);
    expect(win.calls).toEqual([
      'setAlwaysOnTop:false',
      `setBounds:${RECT.width}x${RECT.height}`,
    ]);
  });

  it('round-trips a maximized window: clears on enter, re-maximizes on leave', () => {
    const win = fakeWindow({ maximized: true });
    const state = createCompactState();
    toggleCompact(win, state, true);
    expect(win.calls).toEqual([
      'unmaximize',
      'setAlwaysOnTop:true',
      `setSize:${COMPACT_WIDTH}x${COMPACT_HEIGHT}`,
    ]);
    win.calls.length = 0;
    toggleCompact(win, state, false);
    expect(win.calls).toEqual([
      'setAlwaysOnTop:false',
      `setBounds:${RECT.width}x${RECT.height}`,
      'maximize',
    ]);
  });

  it('round-trips a fullscreen window: exits first on enter, re-enters last on leave', () => {
    const win = fakeWindow({ fullScreen: true });
    const state = createCompactState();
    toggleCompact(win, state, true);
    expect(win.calls).toEqual([
      'setFullScreen:false',
      'setAlwaysOnTop:true',
      `setSize:${COMPACT_WIDTH}x${COMPACT_HEIGHT}`,
    ]);
    win.calls.length = 0;
    toggleCompact(win, state, false);
    expect(win.calls).toEqual([
      'setAlwaysOnTop:false',
      `setBounds:${RECT.width}x${RECT.height}`,
      'setFullScreen:true',
    ]);
  });

  it('is idempotent: re-entering while compact applies nothing and keeps the snapshot', () => {
    const win = fakeWindow({ maximized: true });
    const state = createCompactState();
    toggleCompact(win, state, true);
    win.calls.length = 0;
    const res = toggleCompact(win, state, true); // already compact
    expect(res.isCompactOverlay).toBe(true);
    expect(win.calls).toEqual([]); // no actions — guard short-circuits
    // The ORIGINAL snapshot must survive, so a later leave still restores maximize
    win.calls.length = 0;
    toggleCompact(win, state, false);
    expect(win.calls).toContain('maximize');
  });

  it('is idempotent: leaving when not compact is a no-op', () => {
    const win = fakeWindow();
    const state = createCompactState();
    const res = toggleCompact(win, state, false); // never entered
    expect(res.isCompactOverlay).toBe(false);
    expect(win.calls).toEqual([]);
  });
});
