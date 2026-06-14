/**
 * Find/Replace + Go-To-Line keybindings for Monaco (RENDERER, Lane B).
 *
 * Drop-in replacement for the CM6 findKeymap. Registers the same bindings via
 * Monaco's `editor.addCommand` / `editor.addAction` API instead of CM6
 * KeyBinding[]. The same FindKeymapCallbacks interface is kept unchanged so
 * useFindBar.tsx needs no modifications.
 *
 * Bindings (1:1 with UWP TextEditor.xaml.cs accelerators):
 *   Ctrl+F        → open find bar (find mode)
 *   Ctrl+H        → open find bar (replace mode)
 *   Ctrl+Shift+F  → open find bar (replace mode)   (alt accel)
 *   Ctrl+G        → open go-to-line prompt
 *   F3            → find next (or open bar when no active query)
 *   Shift+F3      → find previous (or open bar)
 *   Escape        → dismiss find bar when open
 *
 * Monaco's built-in Ctrl+F (find widget) is suppressed at editor-create time
 * (`find.addExtraSpaceOnTop: false` + overriding the action below) so the two
 * don't conflict. The built-in F3 / Shift+F3 are also overridden here.
 *
 * Returns a disposable so the caller can tear down all registrations on unmount.
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { FindQuery } from './findController';
import { findNextInEditor, findPreviousInEditor } from './findController';

/** Host hooks the keymap calls into. Identical to the CM6 version. */
export interface FindKeymapCallbacks {
  /** Open the find bar. `replace` selects find vs replace mode. */
  openFindBar(replace: boolean): void;
  /** Dismiss the find bar if open. Returns true if it was open (consumed). */
  dismissFindBar(): boolean;
  /** Open the go-to-line prompt (Ctrl+G). */
  openGoToLine(): void;
  /**
   * The currently-active query, or null when no search is in effect yet.
   * F3/Shift+F3 repeat this query directly; when null they open the bar.
   */
  getActiveQuery(): FindQuery | null;
}

/**
 * Register all find-bar keybindings on `editor`. Returns a disposable that
 * removes every registration on dispose() (call from MonacoEditor unmount).
 */
export function registerFindKeybindings(
  editor: monaco.editor.IStandaloneCodeEditor,
  cb: FindKeymapCallbacks
): monaco.IDisposable {
  // Monaco KeyCode / KeyMod are accessed from the namespace the editor ships.
  // We import the type namespace only above, so access through the global that
  // monaco-editor sets up at runtime (always present when an editor is live).
  const m = (globalThis as unknown as { monaco: typeof import('monaco-editor/esm/vs/editor/editor.api') }).monaco;
  const { KeyMod, KeyCode } = m;

  const disposables: monaco.IDisposable[] = [];

  const add = (d: monaco.IDisposable): void => { disposables.push(d); };

  // Ctrl+F — open find (find mode). Override Monaco's built-in find widget.
  add(editor.addAction({
    id: 'notepade.findBar.open',
    label: 'Open Find Bar',
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyF],
    run() { cb.openFindBar(false); }
  }));

  // Ctrl+H — open find (replace mode).
  add(editor.addAction({
    id: 'notepade.findBar.openReplace',
    label: 'Open Replace Bar',
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyH],
    run() { cb.openFindBar(true); }
  }));

  // Ctrl+Shift+F — alternate replace accel.
  add(editor.addAction({
    id: 'notepade.findBar.openReplaceAlt',
    label: 'Open Replace Bar (Alt)',
    keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF],
    run() { cb.openFindBar(true); }
  }));

  // Ctrl+G — go to line.
  add(editor.addAction({
    id: 'notepade.goToLine',
    label: 'Go To Line',
    keybindings: [KeyMod.CtrlCmd | KeyCode.KeyG],
    run() { cb.openGoToLine(); }
  }));

  // F3 — find next (or open bar if no active query).
  add(editor.addAction({
    id: 'notepade.findBar.findNext',
    label: 'Find Next',
    keybindings: [KeyCode.F3],
    run() {
      const q = cb.getActiveQuery();
      if (!q || q.query.length === 0) { cb.openFindBar(false); return; }
      findNextInEditor(editor, q);
    }
  }));

  // Shift+F3 — find previous (or open bar).
  add(editor.addAction({
    id: 'notepade.findBar.findPrevious',
    label: 'Find Previous',
    keybindings: [KeyMod.Shift | KeyCode.F3],
    run() {
      const q = cb.getActiveQuery();
      if (!q || q.query.length === 0) { cb.openFindBar(false); return; }
      findPreviousInEditor(editor, q);
    }
  }));

  // Escape — dismiss when open. addCommand returns string|null (not IDisposable)
  // so we don't push it to disposables; it's unregistered when the editor disposes.
  editor.addCommand(KeyCode.Escape, () => {
    cb.dismissFindBar();
  });

  return {
    dispose() {
      disposables.forEach((d) => d.dispose());
      disposables.length = 0;
    }
  };
}

/**
 * @deprecated CM6 compat shim. The Monaco path uses registerFindKeybindings.
 * Kept so any import of `findKeymap` from old code compiles without errors
 * during the T3/T6 migration; it returns an empty array (no CM6 KeyBindings).
 */
export function findKeymap(_cb: FindKeymapCallbacks): [] {
  return [];
}
