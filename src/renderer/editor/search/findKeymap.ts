/**
 * Find/Replace + Go-To-Line keymap (RENDERER, Lane B).
 *
 * A self-contained CM6 keymap factory for the find feature's editor-surface
 * bindings, kept OUT of the commands-lane keymap so the two lanes don't both edit
 * the same assembly. The host (App) installs `findKeymap(callbacks)` alongside the
 * commands keymap; the callbacks open/drive the React FindBar and run the
 * controller against the live EditorView.
 *
 * Bindings (1:1 with UWP TextEditor.xaml.cs accelerators + FindAndReplaceControl):
 *   - Ctrl+F        → open the find bar (find mode)        OnFindKeyDown
 *   - Ctrl+H        → open the find bar (replace mode)     OnReplaceKeyDown
 *   - Ctrl+Shift+F  → open the find bar (replace mode)     (alt replace accel)
 *   - Ctrl+G        → open the go-to-line prompt           OnGoToKeyDown
 *   - F3            → find next (wrap)                      OnFindNextKeyDown
 *   - Shift+F3      → find previous (wrap)                  OnFindPreviousKeyDown
 *   - Escape        → dismiss the find bar (when open)      DismissButton
 *
 * F3/Shift+F3 run a find directly when a query is already active (so they work
 * even with the bar focused away/closed, matching UWP where F3 repeats the last
 * search). When no query is active yet they open the bar instead.
 */

import type { KeyBinding } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import type { FindQuery } from './findController';
import { findNextInView, findPreviousInView } from './findController';

/** Host hooks the keymap calls into. The host owns the FindBar open/close state. */
export interface FindKeymapCallbacks {
  /** Open the find bar. `replace` selects find vs replace mode (Ctrl+F/Ctrl+H). */
  openFindBar(replace: boolean): void;
  /** Dismiss the find bar if it is open. Returns true if it was open (consumed). */
  dismissFindBar(): boolean;
  /** Open the go-to-line prompt (Ctrl+G). */
  openGoToLine(): void;
  /**
   * The currently-active query, or null when no search is in effect yet. F3 /
   * Shift+F3 repeat THIS query directly; when null they open the bar instead.
   */
  getActiveQuery(): FindQuery | null;
}

/**
 * Build the find/replace/goto keymap from host callbacks. Pure factory — no
 * module-level state — so each editor instance binds its own host hooks.
 */
export function findKeymap(cb: FindKeymapCallbacks): KeyBinding[] {
  const repeatFind = (view: EditorView, direction: 'next' | 'previous'): boolean => {
    const q = cb.getActiveQuery();
    if (!q || q.query.length === 0) {
      // No active search yet — F3 opens the find bar (UWP shows the bar).
      cb.openFindBar(false);
      return true;
    }
    if (direction === 'next') findNextInView(view, q);
    else findPreviousInView(view, q);
    return true;
  };

  return [
    {
      key: 'Mod-f',
      preventDefault: true,
      run: () => {
        cb.openFindBar(false);
        return true;
      },
    },
    {
      key: 'Mod-h',
      preventDefault: true,
      run: () => {
        cb.openFindBar(true);
        return true;
      },
    },
    {
      key: 'Mod-Shift-f',
      preventDefault: true,
      run: () => {
        cb.openFindBar(true);
        return true;
      },
    },
    {
      key: 'Mod-g',
      preventDefault: true,
      run: () => {
        cb.openGoToLine();
        return true;
      },
    },
    {
      key: 'F3',
      preventDefault: true,
      run: (view) => repeatFind(view, 'next'),
    },
    {
      key: 'Shift-F3',
      preventDefault: true,
      run: (view) => repeatFind(view, 'previous'),
    },
    {
      key: 'Escape',
      // Only consume Escape when the find bar is actually open; otherwise let it
      // fall through to other handlers (CM6 returns false → not handled).
      run: () => cb.dismissFindBar(),
    },
  ];
}
