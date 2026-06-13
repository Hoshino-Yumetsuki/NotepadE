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

import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
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
  }
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
    '.cm-gutters': { fontSize: `${px}px` }
  });
}

/**
 * Write the zoom font-size and schedule a measure.
 *
 * Sets the font-size in THREE places so there is zero timing ambiguity:
 *   1. The CSS variable `--cm-zoom-font-size` on `view.dom` (theme consumers).
 *   2. An inline `fontSize` on `view.contentDOM` — overrides the theme rule so
 *      the content never reads a stale/unresolved CSS variable.
 *   3. An inline `fontSize` on `.cm-gutters` (if mounted) — keeps the native
 *      line-number gutter in lock-step with the content without relying on CSS
 *      variable inheritance, which has construction-order timing gaps for new
 *      (empty) tabs whose editors never receive a `setDoc` remeasure. CM6 owns
 *      the gutter's per-line layout, so matching the font-size is all that is
 *      needed — vertical alignment holds at any zoom by construction.
 */
export function applyZoomFontSize(view: EditorView, px: number): void {
  view.dom.style.setProperty('--cm-zoom-font-size', `${px}px`);
  view.contentDOM.style.fontSize = `${px}px`;
  const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters');
  if (gutters) gutters.style.fontSize = `${px}px`;
  view.requestMeasure();
}

/**
 * ViewPlugin that keeps the `--cm-zoom-font-size` CSS variable on `view.dom` in
 * sync with the zoom field AND the base font-size facet. Must run as a
 * ViewPlugin (not an updateListener) so the variable is set BEFORE sibling
 * ViewPlugins read DOM geometry in the same update cycle — updateListeners fire
 * after all ViewPlugin updates.
 */
export const zoomStyle = ViewPlugin.define((view) => {
  const base = view.state.facet(editorSettings).fontSize;
  const percent = view.state.field(zoomField, false) ?? DEFAULT_ZOOM;
  applyZoomFontSize(view, (base * percent) / 100);
  return {
    update(u: ViewUpdate) {
      const prevZoom = u.startState.field(zoomField, false);
      const nowZoom = u.state.field(zoomField, false);
      const prevBase = u.startState.facet(editorSettings).fontSize;
      const nowBase = u.state.facet(editorSettings).fontSize;
      if (prevZoom === nowZoom && prevBase === nowBase) return;
      const px = ((nowZoom ?? DEFAULT_ZOOM) * nowBase) / 100;
      applyZoomFontSize(u.view, px);
    }
  };
});

/** Base theme binding `.cm-content` + gutter to the zoom CSS variable. */
export const zoomBaseTheme = EditorView.theme({
  '.cm-content': { fontSize: 'var(--cm-zoom-font-size)' },
  '.cm-gutters': { fontSize: 'var(--cm-zoom-font-size)' }
});

/** Initialize the zoom CSS variable for a freshly created view. */
export function initZoomVar(view: EditorView): void {
  const base = view.state.facet(editorSettings).fontSize;
  const percent = view.state.field(zoomField, false) ?? DEFAULT_ZOOM;
  applyZoomFontSize(view, (base * percent) / 100);
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
  }
});
