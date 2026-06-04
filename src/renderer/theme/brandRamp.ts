/**
 * ============================================================================
 *  Accent → Fluent BrandVariants ramp (Phase 5, Stream C)
 * ============================================================================
 *
 * Fluent v9 themes are built from a 16-stop `BrandVariants` ramp (shades 10..160)
 * fed to `createLightTheme` / `createDarkTheme` / `createHighContrastTheme`. The
 * installed @fluentui/react-components barrel does NOT export a "generate a ramp
 * from one hex" helper, so we generate the ramp deterministically here from the
 * app accent color (Windows accent or the user's custom accent).
 *
 * The algorithm mirrors the Fluent theme-designer approach: convert the seed to
 * HSV, then walk a fixed luminance curve to emit lighter shades (10..60) above
 * the seed and darker shades (80..160) below it, keeping hue/saturation stable.
 * Shade 80 is pinned to the seed so the brand color the user picked appears
 * verbatim at the primary token slot (brandForeground/brandBackground anchor).
 *
 * PA-8: pure math — no fs/path/child_process, no IPC. Safe in the renderer.
 */

import type { BrandVariants } from '@fluentui/react-components';

/** The 16 Fluent brand shade keys, light→dark. */
const SHADE_KEYS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] as const;

/**
 * Target HSV "value" (brightness, 0..100) per shade. Light shades sit high,
 * dark shades low; index 7 (shade 80) is the seed anchor and is overridden with
 * the seed's own value at generation time. Curve adapted from the Fluent
 * designer's default value ramp so the output reads as a coherent brand family.
 */
const VALUE_CURVE = [98, 95, 90, 84, 78, 72, 66, 60, 52, 46, 39, 33, 27, 22, 17, 12] as const;

interface Hsv {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
}

/** Parse "#RRGGBB" (or "RRGGBB") to [r,g,b] 0..255, or null if malformed. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

function hsvToHex(hsv: Hsv): string {
  const s = hsv.s / 100;
  const v = hsv.v / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((hsv.h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  const h = hsv.h;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * Build a 16-stop Fluent `BrandVariants` ramp from a single accent hex. The seed
 * is anchored at shade 80; lighter shades raise the HSV value and lower the
 * saturation slightly (toward white), darker shades lower both (toward black),
 * mirroring the Fluent designer's perceptual ramp. A malformed seed falls back
 * to the provided default (which is itself validated by the caller).
 */
export function brandRampFromAccent(accentHex: string): BrandVariants {
  const rgb = parseHex(accentHex);
  // Caller guarantees a valid default; if even that is malformed use Windows blue.
  const base = rgb ?? parseHex('#0078D4')!;
  const seed = rgbToHsv(base[0], base[1], base[2]);

  const ramp = {} as Record<(typeof SHADE_KEYS)[number], string>;
  SHADE_KEYS.forEach((key, i) => {
    if (i === 7) {
      // Shade 80 — the seed verbatim.
      ramp[key] = hsvToHex(seed);
      return;
    }
    const targetV = VALUE_CURVE[i];
    // Pull saturation toward 0 for very light shades, toward full for dark ones,
    // so the ends don't read as muddy mid-tones. Keep hue fixed.
    const s =
      i < 7
        ? seed.s * (0.35 + 0.65 * (1 - (7 - i) / 7)) // lighter → desaturate
        : Math.min(100, seed.s * (1 + 0.08 * (i - 7))); // darker → richer
    ramp[key] = hsvToHex({ h: seed.h, s: Math.max(0, Math.min(100, s)), v: targetV });
  });

  return ramp as unknown as BrandVariants;
}

/** True when `hex` is a well-formed "#RRGGBB" (or "RRGGBB") string. */
export function isValidHex(hex: string): boolean {
  return parseHex(hex) !== null;
}
