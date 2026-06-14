/**
 * Pure color helpers (RENDERER) — zero @codemirror imports.
 *
 * Extracted from the deleted CM6 lineNumberGlow.ts during the Monaco migration
 * (T6) so MonacoEditor's theme code can parse the accent hex without pulling any
 * CodeMirror dependency.
 */

/**
 * Parse a `#RGB` or `#RRGGBB` hex string into 8-bit channels, or null when the
 * input is not a valid 3/6-digit hex color (leading/trailing space tolerated).
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
