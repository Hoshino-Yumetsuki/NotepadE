import { describe, it, expect } from 'vitest';
import {
  planCompactEnter,
  planCompactLeave,
  COMPACT_WIDTH,
  COMPACT_HEIGHT,
  type WindowFlags,
  type CompactSnapshot,
} from './compact-overlay';

/**
 * Compact-overlay state machine (Task #30) — PURE, no electron (matches the
 * argv-parse.ts/searchUrl.ts main-test convention). Asserts snapshot capture and
 * the enter/leave action ORDER, especially the maximized/fullscreen normalization
 * that the original window.ts missed (it shrank a maximized/fullscreen window
 * directly, so restore landed wrong).
 */
const RECT = { x: 100, y: 80, width: 1100, height: 720 };

function flags(over: Partial<WindowFlags> = {}): WindowFlags {
  return { bounds: RECT, alwaysOnTop: false, maximized: false, fullScreen: false, ...over };
}

describe('planCompactEnter', () => {
  it('snapshots all four flags', () => {
    const { snapshot } = planCompactEnter(flags({ alwaysOnTop: true, maximized: true }));
    expect(snapshot).toEqual<CompactSnapshot>({
      bounds: RECT,
      alwaysOnTop: true,
      wasMaximized: true,
      wasFullScreen: false,
    });
  });

  it('from a normal window: always-on-top then shrink (no clear actions)', () => {
    const { actions } = planCompactEnter(flags());
    expect(actions).toEqual([
      { type: 'setAlwaysOnTop', value: true },
      { type: 'setSize', width: COMPACT_WIDTH, height: COMPACT_HEIGHT },
    ]);
  });

  it('clears fullscreen FIRST, then unmaximize, before shrinking', () => {
    const { actions } = planCompactEnter(flags({ maximized: true, fullScreen: true }));
    expect(actions).toEqual([
      { type: 'setFullScreen', value: false },
      { type: 'unmaximize' },
      { type: 'setAlwaysOnTop', value: true },
      { type: 'setSize', width: COMPACT_WIDTH, height: COMPACT_HEIGHT },
    ]);
  });

  it('unmaximizes a maximized (non-fullscreen) window before shrinking', () => {
    const { actions } = planCompactEnter(flags({ maximized: true }));
    expect(actions.map((a) => a.type)).toEqual(['unmaximize', 'setAlwaysOnTop', 'setSize']);
  });
});

describe('planCompactLeave', () => {
  const base: CompactSnapshot = {
    bounds: RECT,
    alwaysOnTop: false,
    wasMaximized: false,
    wasFullScreen: false,
  };

  it('restores always-on-top then bounds for a plain window', () => {
    expect(planCompactLeave(base)).toEqual([
      { type: 'setAlwaysOnTop', value: false },
      { type: 'setBounds', bounds: RECT },
    ]);
  });

  it('re-maximizes after restoring bounds when the window was maximized', () => {
    const out = planCompactLeave({ ...base, wasMaximized: true });
    expect(out.map((a) => a.type)).toEqual(['setAlwaysOnTop', 'setBounds', 'maximize']);
  });

  it('re-enters fullscreen last when the window was fullscreen', () => {
    const out = planCompactLeave({ ...base, wasMaximized: true, wasFullScreen: true });
    expect(out.map((a) => a.type)).toEqual([
      'setAlwaysOnTop',
      'setBounds',
      'maximize',
      'setFullScreen',
    ]);
    expect(out[3]).toEqual({ type: 'setFullScreen', value: true });
  });

  it('preserves a pre-existing always-on-top across the round trip', () => {
    const { snapshot } = planCompactEnter(flags({ alwaysOnTop: true }));
    const leave = planCompactLeave(snapshot);
    expect(leave[0]).toEqual({ type: 'setAlwaysOnTop', value: true });
  });
});
