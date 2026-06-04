/**
 * Zoom as font-size (Ctrl + / Ctrl - / Ctrl 0 / Ctrl+wheel) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.FontSize.cs zoom model:
 *   - Zoom is a PERCENT clamped to [10, 500], default 100.
 *   - Increase/decrease step by 10 percentage points, but FIRST snap an off-grid
 *     value to the next/previous multiple of 10 (UWP: if `_fontZoomFactor % 10 > 0`
 *     it ceils/floors to the nearest 10 instead of stepping). Ctrl+0 resets to 100.
 *   - The effective editor font-size is `baseFontSize * percent / 100`.
 *
 * Implemented as: a `zoomField` StateField holding the percent + a `setZoom`
 * effect, and a `zoomTheme` compartment-ready theme derived from the field that
 * sets `.cm-content` font-size. The host owns the base font-size via the
 * `editorSettings` facet.
 */

import { EditorView } from '@codemirror/view';
import { StateField, StateEffect, type Extension } from '@codemirror/state';
import { editorSettings } from '../editorSettings';

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 500;
export const DEFAULT_ZOOM = 100;
const STEP = 10;

/** Effect carrying an absolute zoom percent (already clamped by the reducer). */
export const setZoom = StateEffect.define<number>();

function clampZoom(percent: number): number {
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

/** Per-editor zoom percent. */
export const zoomField = StateField.define<number>({
  create() {
    return DEFAULT_ZOOM;
  },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setZoom)) next = clampZoom(e.value);
    }
    return next;
  },
});

/**
 * Theme that applies the zoomed font-size. It reads `zoomField` and the base
 * font-size from `editorSettings`, recomputing `.cm-content`/`.cm-gutters`
 * font-size whenever either changes (the field is recreated each reconfigure).
 */
function zoomTheme(view: EditorView): Extension {
  const percent = view.state.field(zoomField);
  const base = view.state.facet(editorSettings).fontSize;
  const px = (base * percent) / 100;
  return EditorView.theme({
    '.cm-content': { fontSize: `${px}px` },
    '.cm-gutters': { fontSize: `${px}px` },
  });
}

/**
 * A ViewPlugin that keeps an inline font-size style on `.cm-scroller` in sync
 * with the zoom field. Using an inline style (not a regenerated theme) keeps the
 * update cheap and avoids reconfiguration churn on every wheel tick.
 */
export const zoomStyle = EditorView.updateListener.of((update) => {
  const prev = update.startState.field(zoomField, false);
  const now = update.state.field(zoomField, false);
  if (prev === now) return;
  const base = update.state.facet(editorSettings).fontSize;
  const px = ((now ?? DEFAULT_ZOOM) * base) / 100;
  update.view.dom.style.setProperty('--cm-zoom-font-size', `${px}px`);
});

/** Base theme binding `.cm-content` to the zoom CSS variable. */
export const zoomBaseTheme = EditorView.theme({
  '.cm-content': { fontSize: 'var(--cm-zoom-font-size)' },
  '.cm-gutters': { fontSize: 'var(--cm-zoom-font-size)' },
});

/** Initialize the zoom CSS variable for a freshly created view. */
export function initZoomVar(view: EditorView): void {
  const base = view.state.facet(editorSettings).fontSize;
  const percent = view.state.field(zoomField, false) ?? DEFAULT_ZOOM;
  view.dom.style.setProperty('--cm-zoom-font-size', `${(base * percent) / 100}px`);
}

void zoomTheme;

// --- Commands -------------------------------------------------------------

/** Ctrl + (and Ctrl =): zoom in. */
export function zoomIn(view: EditorView): boolean {
  const cur = view.state.field(zoomField);
  const next = nextZoomIn(cur);
  if (next === cur) return true;
  view.dispatch({ effects: setZoom.of(next) });
  return true;
}

/** Ctrl -: zoom out. */
export function zoomOut(view: EditorView): boolean {
  const cur = view.state.field(zoomField);
  const next = nextZoomOut(cur);
  if (next === cur) return true;
  view.dispatch({ effects: setZoom.of(next) });
  return true;
}

/** Ctrl 0 / Ctrl Num0: reset zoom to 100%. */
export function zoomReset(view: EditorView): boolean {
  if (view.state.field(zoomField) === DEFAULT_ZOOM) return true;
  view.dispatch({ effects: setZoom.of(DEFAULT_ZOOM) });
  return true;
}

/**
 * Ctrl+wheel zoom. One notch (deltaY) = one in/out step. Returns true when the
 * event was a zoom gesture (so the caller can preventDefault to stop scroll).
 */
export const ctrlWheelZoom = EditorView.domEventHandlers({
  wheel(event, view) {
    if (!event.ctrlKey) return false;
    event.preventDefault();
    if (event.deltaY < 0) zoomIn(view);
    else if (event.deltaY > 0) zoomOut(view);
    return true;
  },
});
