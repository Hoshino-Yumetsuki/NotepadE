/**
 * Pure zoom math — editor-agnostic, zero @codemirror imports.
 *
 * Self-contained as of the Monaco migration (T6): the pure zoom percent model
 * (clamp [10,500], snap-then-step by 10) lives here outright, no longer re-exported
 * from the deleted CM6 `../zoom`. Ported 1:1 from UWP TextEditorCore.FontSize.cs.
 */

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 500;
export const DEFAULT_ZOOM = 100;
/** The step between zoom levels. */
export const STEP = 10;

/** Clamp `percent` to [MIN_ZOOM, MAX_ZOOM]. */
export function clampZoom(percent: number): number {
  if (percent < MIN_ZOOM) return MIN_ZOOM;
  if (percent > MAX_ZOOM) return MAX_ZOOM;
  return percent;
}

/** Next zoom percent on "increase" (UWP IncreaseFontSize snap-then-step). */
export function nextZoomIn(current: number): number {
  if (current >= MAX_ZOOM) return MAX_ZOOM;
  if (current % STEP > 0) return clampZoom(Math.ceil(current / STEP) * STEP);
  return clampZoom(current + STEP);
}

/** Next zoom percent on "decrease" (UWP DecreaseFontSize snap-then-step). */
export function nextZoomOut(current: number): number {
  if (current <= MIN_ZOOM) return MIN_ZOOM;
  if (current % STEP > 0) return clampZoom(Math.floor(current / STEP) * STEP);
  return clampZoom(current - STEP);
}
