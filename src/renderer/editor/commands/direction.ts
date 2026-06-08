/**
 * Text flow direction LTR / RTL (Ctrl+L / Ctrl+R) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.SwitchTextFlowDirection (which sets FlowDirection +
 * TextReadingOrder.UseFlowDirection) onto CM6's content `dir` attribute via
 * `EditorView.contentAttributes` (CM6 derives `textDirection` from the DOM dir).
 *
 * Direction is editor-local state held in a Compartment so the commands can
 * reconfigure it live without rebuilding the whole editor. The host can read /
 * seed the initial direction through `directionCompartment`.
 */

import { Compartment, type Extension } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';

export type TextDirection = 'ltr' | 'rtl';

/** Compartment wrapping the active `EditorView.contentDirection` extension. */
export const directionCompartment = new Compartment();

/** The extension for a given direction (mount inside directionCompartment). */
export function directionExtension(dir: TextDirection): Extension {
  return EditorView.contentAttributes.of({ dir });
}

/** Reconfigure the editor's content direction. */
function setDirection(view: EditorView, dir: TextDirection): boolean {
  view.dispatch({
    effects: directionCompartment.reconfigure(directionExtension(dir))
  });
  return true;
}

/** Ctrl+L — set left-to-right. */
export const setLtr: Command = (view) => setDirection(view, 'ltr');

/** Ctrl+R — set right-to-left. */
export const setRtl: Command = (view) => setDirection(view, 'rtl');
