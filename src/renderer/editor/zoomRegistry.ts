/**
 * Per-editor zoom registry (RENDERER, Lane B).
 *
 * Monaco has no built-in zoom percent (only an absolute `fontSize` option), and
 * no event fires on a font-size change. To keep ALL zoom entry points in sync —
 * the status-bar slider/buttons (useStatusBarModel) AND the keyboard chords +
 * Ctrl+wheel (monacoCommands) — they must funnel through ONE source of truth.
 *
 * That source is this module-level WeakMap (keyed on the editor instance, so an
 * entry GCs with its editor). Every zoom mutation writes the registry and calls
 * `editor.updateOptions({ fontSize })`; the status bar reads `getEditorZoom` so
 * its percentage always reflects keyboard/wheel zoom and vice-versa.
 *
 * Lives in its own module (not in useStatusBarModel) so monacoCommands can import
 * it without a circular edge (monacoCommands → useStatusBarModel → MonacoEditor
 * type → monacoCommands).
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, nextZoomIn, nextZoomOut } from './commands/logic/zoom';

interface ZoomEntry {
  /** Current zoom percent [MIN_ZOOM, MAX_ZOOM]. */
  percent: number;
  /** Base font size at 100% zoom (px). Set on mount, updated on a font-size setting change. */
  basePx: number;
}

const zoomRegistry = new WeakMap<monaco.editor.IStandaloneCodeEditor, ZoomEntry>();

/** Read the stored zoom percent for an editor (default 100). */
export function getEditorZoom(editor: monaco.editor.IStandaloneCodeEditor): number {
  return zoomRegistry.get(editor)?.percent ?? DEFAULT_ZOOM;
}

/**
 * Initialize the zoom registry entry for a freshly mounted editor. Call this once
 * from MonacoEditor.tsx right after monaco.editor.create. `baseFontSizePx` is the
 * host-provided fontSize prop at 100% zoom.
 */
export function initEditorZoom(
  editor: monaco.editor.IStandaloneCodeEditor,
  baseFontSizePx: number
): void {
  zoomRegistry.set(editor, { percent: DEFAULT_ZOOM, basePx: baseFontSizePx });
}

/**
 * Apply an absolute zoom percent to an editor. Updates the registry and calls
 * editor.updateOptions so the font size changes immediately. Used by both the
 * status-bar slider (applyZoom) and the keyboard/wheel zoom commands.
 */
export function applyEditorZoom(
  editor: monaco.editor.IStandaloneCodeEditor,
  percent: number
): void {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent));
  const entry = zoomRegistry.get(editor);
  const basePx = entry?.basePx ?? 14;
  zoomRegistry.set(editor, { percent: clamped, basePx });
  editor.updateOptions({ fontSize: Math.round((basePx * clamped) / 100) });
}

/** Apply a zoom step (in / out / reset) via the shared registry. */
export function stepEditorZoom(
  editor: monaco.editor.IStandaloneCodeEditor,
  step: 'in' | 'out' | 'reset'
): void {
  const current = getEditorZoom(editor);
  const next =
    step === 'in' ? nextZoomIn(current) : step === 'out' ? nextZoomOut(current) : DEFAULT_ZOOM;
  if (next !== current) applyEditorZoom(editor, next);
}

/**
 * Update the 100%-base font size for an editor (the user changed the font-size
 * setting) and re-apply the CURRENT zoom percent on the new base, so a zoomed
 * editor scales the new base rather than snapping back to 100%. Keeps the registry
 * authoritative when typography changes outside the zoom controls.
 */
export function setEditorZoomBase(
  editor: monaco.editor.IStandaloneCodeEditor,
  baseFontSizePx: number
): void {
  const percent = getEditorZoom(editor);
  zoomRegistry.set(editor, { percent, basePx: baseFontSizePx });
  editor.updateOptions({ fontSize: Math.round((baseFontSizePx * percent) / 100) });
}
