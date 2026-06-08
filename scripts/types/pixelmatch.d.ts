/**
 * Ambient declaration for pixelmatch v6 (ESM, no bundled types and the published
 * @types target the v5 CommonJS shape). Matches the v6 signature used by
 * scripts/visual-diff.ts.
 *
 * pixelmatch(img1, img2, output, width, height, options?) -> number of diff pixels.
 */
declare module 'pixelmatch' {
  interface PixelmatchOptions {
    /** Matching threshold (0..1); smaller is more sensitive. Default 0.1. */
    threshold?: number;
    /** Whether to skip anti-aliasing detection. Default false. */
    includeAA?: boolean;
    /** Blending factor of unchanged pixels in the diff output (0..1). */
    alpha?: number;
    /** Color of anti-aliased pixels in the diff output [r,g,b]. */
    aaColor?: [number, number, number];
    /** Color of differing pixels in the diff output [r,g,b]. */
    diffColor?: [number, number, number];
    /** Alternative color for dark-on-light differences [r,g,b]. */
    diffColorAlt?: [number, number, number];
    /** Draw the diff over a transparent background instead of the original. */
    diffMask?: boolean;
  }

  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray | Buffer,
    img2: Uint8Array | Uint8ClampedArray | Buffer,
    output: Uint8Array | Uint8ClampedArray | Buffer | null,
    width: number,
    height: number,
    options?: PixelmatchOptions
  ): number;
}
