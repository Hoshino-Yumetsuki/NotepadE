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
  }
});

/** Alt+Z — toggle word wrap (updates the field AND reconfigures the compartment). */
export const toggleWordWrap: Command = (view) => {
  const next = !view.state.field(wordWrapField);
  view.dispatch({
    effects: [setWordWrap.of(next), wordWrapCompartment.reconfigure(wordWrapExtension(next))]
  });
  return true;
};

/**
 * Bridge from CM6 into React for the GLOBAL word-wrap preference. When the host
 * installs a callback here, Alt+Z (and the right-click "Word Wrap" item) flip the
 * persisted `textWrapping` setting instead of just this one editor's compartment —
 * so word wrap becomes a single app-wide preference applied to every open file and
 * surviving restarts, rather than a per-editor, per-file ephemeral toggle (which
 * forced users to re-enable it in each new tab). Left null in tests / when no host
 * is mounted, where `toggleWordWrapPreferGlobal` falls back to the local toggle.
 */
export const wordWrapToggleRef: { current: (() => void) | null } = { current: null };

/**
 * Toggle word wrap the way the user expects: prefer the global setting bridge when
 * the host has wired it (change applies to ALL editors and persists), otherwise
 * fall back to the local per-editor compartment toggle.
 */
export const toggleWordWrapPreferGlobal: Command = (view) => {
  const cb = wordWrapToggleRef.current;
  if (cb) {
    cb();
    return true;
  }
  return toggleWordWrap(view);
};
