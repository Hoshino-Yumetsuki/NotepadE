/**
 * Shared font-family resolution for every surface that renders document text:
 * the Monaco editor, the side-by-side diff viewer, and the print host. Kept in a
 * standalone, dependency-free module so the lazy diff/print chunks can import the
 * resolver WITHOUT pulling in MonacoEditor (and Monaco itself).
 */

/** UWP RichEditBox default (Segoe UI / normal-400) — used when no font is set. */
export const DEFAULT_FONT_FAMILY =
  '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif';

/**
 * Resolve the stored font-family to a full CSS value with fallbacks (mirrors the
 * CM6 component): empty → system stack; a named font gets a monospace fallback
 * chain so a CJK locale doesn't fall back to 宋体.
 */
export function resolveFontFamily(family: string): string {
  if (!family) return DEFAULT_FONT_FAMILY;
  if (family.includes('monospace') || family.includes('sans-serif')) return family;
  return `${family}, "SF Mono", Menlo, Monaco, Consolas, "Cascadia Mono", "Courier New", monospace`;
}
