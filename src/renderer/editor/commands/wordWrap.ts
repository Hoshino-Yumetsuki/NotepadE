/**
 * Word-wrap toggle (Alt+Z) — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore TextWrapping toggle (Wrap <-> NoWrap) onto CM6's
 * `EditorView.lineWrapping`, held in a Compartment so it can be reconfigured
 * live. A small StateField tracks the boolean wrap state so the toggle reads it
 * deterministically (instead of sniffing DOM styles).
 *
 * Default: no wrap (CM6 default; matches UWP NoWrap default). The host seeds the
 * initial state by mounting `wordWrapCompartment.of(wordWrapExtension(initial))`
 * AND the matching `wordWrapField` initial value.
 */

import { Compartment, StateField, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';

/** Effect carrying the absolute desired wrap state (set by the toggle command). */
export const setWordWrap = StateEffect.define<boolean>();

/** Compartment wrapping the optional `EditorView.lineWrapping` extension. */
export const wordWrapCompartment = new Compartment();

/** The extension for a given wrap state (mount inside wordWrapCompartment). */
export function wordWrapExtension(wrap: boolean): Extension {
  return wrap ? EditorView.lineWrapping : [];
}

/** Per-editor word-wrap flag, kept in sync via the `setWordWrap` effect. */
export const wordWrapField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(setWordWrap)) next = e.value;
    }
    return next;
  },
});

/** Alt+Z — toggle word wrap (updates the field AND reconfigures the compartment). */
export const toggleWordWrap: Command = (view) => {
  const next = !view.state.field(wordWrapField);
  view.dispatch({
    effects: [setWordWrap.of(next), wordWrapCompartment.reconfigure(wordWrapExtension(next))],
  });
  return true;
};
