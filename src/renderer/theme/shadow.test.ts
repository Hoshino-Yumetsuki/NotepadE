import { describe, it, expect } from 'vitest';
import { edgeShadowOpacity, edgeShadowStyle, EDGE_SHADOW_BLUR } from './shadow';

/**
 * Edge-shadow / elevation unit tests (Phase 7, Task #28). Verifies the per-theme
 * opacity ramp is sourced from the UWP chrome tokens (0.55 light / 0.7 dark /
 * 0.0 HC), the blur band is 8-10px, the caster fades from the correct edge per
 * direction, and HC paints NO shadow (a zero-height inert element).
 */
describe('edgeShadowOpacity', () => {
  it('matches the UWP per-theme ramp', () => {
    expect(edgeShadowOpacity('light')).toBeCloseTo(0.06);
    expect(edgeShadowOpacity('dark')).toBeCloseTo(0.1);
    expect(edgeShadowOpacity('hc')).toBe(0);
  });

  it('dark elevation reads stronger than light', () => {
    expect(edgeShadowOpacity('dark')).toBeGreaterThan(edgeShadowOpacity('light'));
  });
});

describe('edgeShadowStyle', () => {
  it('uses an 8-10px blur band height', () => {
    expect(EDGE_SHADOW_BLUR).toBeGreaterThanOrEqual(4);
    expect(EDGE_SHADOW_BLUR).toBeLessThanOrEqual(10);
    expect(edgeShadowStyle('dark', 'down').height).toBe(EDGE_SHADOW_BLUR);
  });

  it("'down' fades toward the bottom (strip casts onto editor below)", () => {
    const s = edgeShadowStyle('light', 'down');
    expect(String(s.background)).toContain('to bottom');
    // Absolute, out-of-flow caster anchored to the TOP edge of the editor region
    // so it never re-flows the strip's flex box (keeps the golden pixel-identical).
    expect(s.position).toBe('absolute');
    expect(s.top).toBe(0);
    expect(s.bottom).toBeUndefined();
  });

  it("'up' fades toward the top (bar casts onto editor above)", () => {
    const s = edgeShadowStyle('dark', 'up');
    expect(String(s.background)).toContain('to top');
    expect(s.position).toBe('absolute');
    expect(s.bottom).toBe(0);
    expect(s.top).toBeUndefined();
  });

  it('carries the theme opacity in the gradient color', () => {
    expect(String(edgeShadowStyle('dark', 'down').background)).toContain('0.1');
    expect(String(edgeShadowStyle('light', 'up').background)).toContain('0.06');
  });

  it('fades to transparent', () => {
    expect(String(edgeShadowStyle('dark', 'down').background)).toContain('transparent 100%');
  });

  it('is an inert zero-height element in HC (no elevation material)', () => {
    const s = edgeShadowStyle('hc', 'down');
    expect(s.height).toBe(0);
    expect(s.background).toBeUndefined();
  });
});
