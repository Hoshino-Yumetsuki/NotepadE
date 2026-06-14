import { describe, it, expect } from 'vitest';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, STEP, nextZoomIn, nextZoomOut, clampZoom } from './zoom';

describe('constants', () => {
  it('has correct MIN/MAX/DEFAULT/STEP', () => {
    expect(MIN_ZOOM).toBe(10);
    expect(MAX_ZOOM).toBe(500);
    expect(DEFAULT_ZOOM).toBe(100);
    expect(STEP).toBe(10);
  });
});

describe('clampZoom', () => {
  it('clamps below minimum', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MIN_ZOOM);
  });

  it('clamps above maximum', () => {
    expect(clampZoom(600)).toBe(MAX_ZOOM);
  });

  it('passes through values in range', () => {
    expect(clampZoom(100)).toBe(100);
  });
});

describe('nextZoomIn / nextZoomOut', () => {
  it('steps up by 10 from a grid value', () => {
    expect(nextZoomIn(100)).toBe(110);
  });

  it('snaps an off-grid value UP to the next multiple of 10', () => {
    expect(nextZoomIn(105)).toBe(110);
  });

  it('steps down by 10 from a grid value', () => {
    expect(nextZoomOut(100)).toBe(90);
  });

  it('snaps an off-grid value DOWN to the previous multiple of 10', () => {
    expect(nextZoomOut(105)).toBe(100);
  });

  it('clamps at the maximum', () => {
    expect(nextZoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(nextZoomIn(495)).toBe(MAX_ZOOM);
  });

  it('clamps at the minimum', () => {
    expect(nextZoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(nextZoomOut(15)).toBe(MIN_ZOOM);
  });
});
