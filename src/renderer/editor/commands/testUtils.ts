import { EditorState, EditorSelection, type SelectionRange, type StateCommand, type Extension } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';
import { editorSettings, type EditorSettings } from '../editorSettings';

/**
 * Shared test helpers for the editor-command specs (RENDERER, Lane B).
 *
 * Two flavors:
 *   - `runStateCommand`: drives a pure StateCommand against a fresh EditorState,
 *     returning the resulting doc + main selection. No DOM needed.
 *   - `mountView`: mounts a real EditorView (jsdom) for commands that need a view
 *     (zoom/direction/wordWrap/datetime .LOG/smartCopy DOM handlers).
 */

export interface RunResult {
  doc: string;
  anchor: number;
  head: number;
  from: number;
  to: number;
  changed: boolean;
}

/** A cursor/range from EditorSelection.cursor()/.range() or a full selection. */
export type SelectionLike = EditorSelection | SelectionRange;

/** Run a StateCommand; optionally seed the editorSettings facet. */
export function runStateCommand(
  command: StateCommand,
  doc: string,
  selection: SelectionLike,
  settings?: Partial<EditorSettings>,
): RunResult {
  const extensions = settings ? [editorSettings.of(settings)] : [];
  let state = EditorState.create({ doc, selection, extensions });
  let changed = false;
  const result = command({
    state,
    dispatch: (tr) => {
      changed = true;
      state = tr.state;
    },
  });
  // A command may return true yet dispatch nothing (no-op consume); track both.
  void result;
  const m = state.selection.main;
  return { doc: state.doc.toString(), anchor: m.anchor, head: m.head, from: m.from, to: m.to, changed };
}

/** Mount a real EditorView for view-driven commands. Caller destroys it. */
export function mountView(
  doc: string,
  selection: SelectionLike,
  extensions: Extension = [],
): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, selection, extensions }),
    parent,
  });
}

/** Run a view Command and return whether it reported handled. */
export function runViewCommand(command: Command, view: EditorView): boolean {
  return command(view);
}

export { EditorSelection };
