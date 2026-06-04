/**
 * Unit tests for the accent → BrandVariants ramp generator (Phase 5, Stream C).
 *
 * The ramp must: produce all 16 Fluent shade keys, anchor shade 80 to the seed
 * verbatim, emit valid #RRGGBB at every stop, run light→dark monotonically in
 * brightness, and tolerate malformed input by falling back to a valid ramp.
 */

import { describe, it, expect } from 'vitest';
import { brandRampFromAccent, isValidHex } from './brandRamp';

const SHADE_KEYS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('isValidHex', () => {
  it('accepts #RRGGBB and bare RRGGBB', () => {
    expect(isValidHex('#0078D4')).toBe(true);
    expect(isValidHex('0078d4')).toBe(true);
  });
  it('rejects malformed values', () => {
    expect(isValidHex('')).toBe(false);
    expect(isValidHex('#fff')).toBe(false);
    expect(isValidHex('#12345g')).toBe(false);
    expect(isValidHex('rgb(0,0,0)')).toBe(false);
  });
});

describe('brandRampFromAccent', () => {
  it('emits all 16 Fluent shade keys as valid #RRGGBB', () => {
    const ramp = brandRampFromAccent('#0078D4') as Record<number, string>;
    for (const key of SHADE_KEYS) {
      expect(ramp[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('anchors shade 80 to the seed color verbatim', () => {
    const ramp = brandRampFromAccent('#0078D4') as Record<number, string>;
    // Allow ±1 per channel for HSV round-trip rounding.
    const seed = [0x00, 0x78, 0xd4];
    const got = ramp[80].slice(1);
    const gv = [
      parseInt(got.slice(0, 2), 16),
      parseInt(got.slice(2, 4), 16),
      parseInt(got.slice(4, 6), 16),
    ];
    gv.forEach((c, i) => expect(Math.abs(c - seed[i])).toBeLessThanOrEqual(1));
  });

  it('keeps the lightest shade brighter than the darkest, seed in between', () => {
    const ramp = brandRampFromAccent('#0078D4') as Record<number, string>;
    const lightest = luminance(ramp[10]);
    const darkest = luminance(ramp[160]);
    const seed = luminance(ramp[80]);
    expect(lightest).toBeGreaterThan(darkest);
    expect(seed).toBeGreaterThanOrEqual(darkest);
    expect(seed).toBeLessThanOrEqual(lightest);
  });

  it('trends darker overall from the light end to the dark end', () => {
    const ramp = brandRampFromAccent('#0078D4') as Record<number, string>;
    // Average luminance of the light half exceeds the dark half (coherent ramp).
    const lightHalf = [10, 20, 30, 40, 50, 60, 70, 80].map((k) => luminance(ramp[k]));
    const darkHalf = [90, 100, 110, 120, 130, 140, 150, 160].map((k) => luminance(ramp[k]));
    const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
    expect(avg(lightHalf)).toBeGreaterThan(avg(darkHalf));
  });

  it('falls back to a valid ramp for malformed input', () => {
    const ramp = brandRampFromAccent('not-a-color') as Record<number, string>;
    for (const key of SHADE_KEYS) {
      expect(ramp[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('produces a different ramp for a different accent', () => {
    const blue = brandRampFromAccent('#0078D4') as Record<number, string>;
    const red = brandRampFromAccent('#D40078') as Record<number, string>;
    expect(blue[80]).not.toBe(red[80]);
  });
});
