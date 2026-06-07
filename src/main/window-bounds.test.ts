import { describe, it, expect } from 'vitest';
import {
  resolveBounds,
  serializeBounds,
  DEFAULT_BOUNDS,
  type WorkArea,
  type PersistedBounds,
} from './window-bounds';

/**
 * Pure geometry tests for window-bounds (electron-free, per the window.test.ts
 * convention). The disk IO + BrowserWindow wiring stay e2e-covered.
 */

const PRIMARY: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe('resolveBounds', () => {
  it('returns null for a missing/empty record (caller centers default)', () => {
    expect(resolveBounds(null, [PRIMARY])).toBeNull();
    expect(resolveBounds(undefined, [PRIMARY])).toBeNull();
    expect(resolveBounds({}, [PRIMARY])).toBeNull();
  });

  it('returns null when any coordinate is non-finite', () => {
    expect(resolveBounds({ x: 10, y: 10, width: Number.NaN, height: 600 }, [PRIMARY])).toBeNull();
  });

  it('passes through an on-screen record, flooring + clamping to minimums', () => {
    const saved: PersistedBounds = {
      x: 100.7,
      y: 50.2,
      width: 200, // below MIN_WIDTH 480
      height: 1000.9,
      isMaximized: false,
    };
    const r = resolveBounds(saved, [PRIMARY]);
    expect(r).toEqual({ x: 100, y: 50, width: 480, height: 1000, isMaximized: false });
  });

  it('preserves the maximized flag', () => {
    const r = resolveBounds({ x: 10, y: 10, width: 800, height: 600, isMaximized: true }, [
      PRIMARY,
    ]);
    expect(r?.isMaximized).toBe(true);
  });

  it('drops a stale off-screen position (NaN x/y) but keeps the size', () => {
    // Saved on a now-disconnected monitor at x=3000; only the primary remains.
    const r = resolveBounds({ x: 3000, y: 200, width: 900, height: 700, isMaximized: false }, [
      PRIMARY,
    ]);
    expect(Number.isNaN(r?.x as number)).toBe(true);
    expect(Number.isNaN(r?.y as number)).toBe(true);
    expect(r?.width).toBe(900);
    expect(r?.height).toBe(700);
  });

  it('accepts a position on a secondary display work area', () => {
    const secondary: WorkArea = { x: 1920, y: 0, width: 1920, height: 1040 };
    const r = resolveBounds({ x: 2000, y: 100, width: 900, height: 700, isMaximized: false }, [
      PRIMARY,
      secondary,
    ]);
    expect(r?.x).toBe(2000);
    expect(r?.y).toBe(100);
  });

  it('keeps the position when no work areas are known (headless)', () => {
    const r = resolveBounds({ x: 50, y: 60, width: 800, height: 600, isMaximized: false }, []);
    expect(r?.x).toBe(50);
    expect(r?.y).toBe(60);
  });
});

describe('serializeBounds', () => {
  it('round-trips through JSON', () => {
    const b: PersistedBounds = { x: 1, y: 2, width: 800, height: 600, isMaximized: true };
    expect(JSON.parse(serializeBounds(b))).toEqual(b);
  });
});

describe('DEFAULT_BOUNDS', () => {
  it('matches the historical hardcoded window size', () => {
    expect(DEFAULT_BOUNDS).toEqual({ width: 1100, height: 720 });
  });
});
