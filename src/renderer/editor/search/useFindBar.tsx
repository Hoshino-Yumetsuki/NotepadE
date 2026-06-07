/**
 * Find-bar host hook (RENDERER, Lane B).
 *
 * Encapsulates ALL find/replace host state so the App shell only has to (1) call
 * this hook with a getter for the active editor's EditorView, (2) render the
 * returned `findBar` element, and (3) spread the returned `keymapCallbacks` /
 * `editorExtensions` into each CM6 instance. Keeping it here means the find
 * feature owns its own React/CM6 glue without bloating App.tsx and without the
 * commands lane needing to know find internals.
 *
 * It binds the React FindBar widget to the CM6 controller:
 *   - open/close + find-vs-replace mode state,
 *   - live highlight refresh as the query/options change,
 *   - find next/prev (wrap), replace-one (N undo), replace-all (1 undo),
 *   - the active-query snapshot F3/Shift+F3 repeat against,
 *   - a go-to-line prompt (Ctrl+G).
 *
 * PA-8: renderer-only; touches the EditorView + DOM, never window.notepads / fs.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { FindBar, type FindDirection } from './FindBar';
import type { SearchOptions } from './searchEngine';
import {
  type FindQuery,
  type FindOutcome,
  findNextInView,
  findPreviousInView,
  replaceOne,
  replaceAllInView,
  goToLine,
  refreshHighlights,
  clearHighlights,
  searchExtension,
} from './findController';
import { findKeymap, type FindKeymapCallbacks } from './findKeymap';
import { GoToLineDialog } from './GoToLineDialog';
import { useT, type Translator } from '../../i18n';

/** What the App must provide: a getter for the currently-active editor view. */
export interface UseFindBarOptions {
  /** The active tab's live EditorView, or null when none is focused. */
  getActiveView: () => EditorView | null;
}

/** What the hook hands back to the App shell. */
export interface FindBarHost {
  /** The find bar element to render (null when the bar is closed). */
  findBar: JSX.Element | null;
  /** Callbacks the CM6 keymap needs (Ctrl+F/H/G, F3/Shift+F3, Esc). */
  keymapCallbacks: FindKeymapCallbacks;
  /** CM6 extensions every editor must install (the match-highlight field). */
  editorExtensions: Extension;
  /** Convenience: the assembled find keymap bindings (keymap.of these). */
  keymap: ReturnType<typeof findKeymap>;
}

/** Format the UWP-style "n of m" / "No results" status text. */
function formatStatus(
  outcome: FindOutcome | null,
  hasQuery: boolean,
  t: Translator['t'],
): string | undefined {
  if (!hasQuery) return undefined;
  if (!outcome || !outcome.match) return t('FindAndReplace_NotificationMsg_NotFound');
  return outcome.wrapped ? 'Wrapped' : undefined;
}

export function useFindBar(opts: UseFindBarOptions): FindBarHost {
  const { getActiveView } = opts;

  const { t } = useT();

  const [open, setOpen] = useState<boolean>(false);
  const [showReplace, setShowReplace] = useState<boolean>(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  // Re-mount key so re-opening the bar re-seeds focus/selection (FindBar_GotFocus).
  const [seedKey, setSeedKey] = useState<number>(0);

  // Go-to-line dialog state (UWP GoToControl). Holds the current + total lines so
  // the dialog can seed the input and validate the upper bound.
  const [goToState, setGoToState] = useState<{ currentLine: number; lineCount: number } | null>(
    null,
  );

  // The last query/options the user searched with — what F3/Shift+F3 repeat.
  const activeQueryRef = useRef<FindQuery | null>(null);

  const toQuery = (query: string, options: SearchOptions): FindQuery => ({ query, ...options });

  // --- Open / dismiss --------------------------------------------------------

  const openFindBar = useCallback((replace: boolean) => {
    setShowReplace(replace);
    setOpen(true);
    setSeedKey((k) => k + 1); // re-seed focus + selection on every open
  }, []);

  const dismissFindBar = useCallback((): boolean => {
    if (!open) return false; // not consumed — let Esc fall through
    setOpen(false);
    setStatus(undefined);
    const view = getActiveView();
    if (view) {
      clearHighlights(view);
      view.focus();
    }
    return true;
  }, [open, getActiveView]);

  const openGoToLine = useCallback(() => {
    const view = getActiveView();
    if (!view) return;
    const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number;
    setGoToState({ currentLine, lineCount: view.state.doc.lines });
  }, [getActiveView]);

  const onGoToSubmit = useCallback(
    (line: number) => {
      setGoToState(null);
      const view = getActiveView();
      if (!view) return;
      goToLine(view, line);
      view.focus();
    },
    [getActiveView],
  );

  const onGoToCancel = useCallback(() => {
    setGoToState(null);
    getActiveView()?.focus();
  }, [getActiveView]);

  // --- Live query change (highlight refresh) ---------------------------------

  const onQueryChange = useCallback(
    (query: string, options: SearchOptions) => {
      const q = toQuery(query, options);
      activeQueryRef.current = query.length > 0 ? q : null;
      const view = getActiveView();
      if (!view) return;
      refreshHighlights(view, q);
      if (query.length === 0) setStatus(undefined);
    },
    [getActiveView],
  );

  // --- Find / replace actions ------------------------------------------------

  const onFind = useCallback(
    (query: string, options: SearchOptions, direction: FindDirection) => {
      const view = getActiveView();
      if (!view) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const outcome = direction === 'next' ? findNextInView(view, q) : findPreviousInView(view, q);
      setStatus(formatStatus(outcome, query.length > 0, t));
    },
    [getActiveView, t],
  );

  const onReplaceOne = useCallback(
    (query: string, options: SearchOptions, replacement: string, _direction: FindDirection) => {
      const view = getActiveView();
      if (!view) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const did = replaceOne(view, q, replacement);
      setStatus(did ? undefined : t('FindAndReplace_NotificationMsg_NotFound'));
      refreshHighlights(view, q);
    },
    [getActiveView, t],
  );

  const onReplaceAll = useCallback(
    (query: string, options: SearchOptions, replacement: string) => {
      const view = getActiveView();
      if (!view) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const count = replaceAllInView(view, q, replacement);
      setStatus(count > 0 ? `Replaced ${count}` : t('FindAndReplace_NotificationMsg_NotFound'));
      refreshHighlights(view, q);
    },
    [getActiveView, t],
  );

  // --- Editor seam (keymap + extensions) -------------------------------------

  const keymapCallbacks = useMemo<FindKeymapCallbacks>(
    () => ({
      openFindBar,
      dismissFindBar,
      openGoToLine,
      getActiveQuery: () => activeQueryRef.current,
    }),
    [openFindBar, dismissFindBar, openGoToLine],
  );

  const keymap = useMemo(() => findKeymap(keymapCallbacks), [keymapCallbacks]);
  const editorExtensions = useMemo<Extension>(() => searchExtension(), []);

  const findBar =
    open || goToState ? (
      <>
        {open ? (
          <FindBar
            key={seedKey}
            showReplace={showReplace}
            onFind={onFind}
            onReplaceOne={onReplaceOne}
            onReplaceAll={onReplaceAll}
            onQueryChange={onQueryChange}
            onToggleReplace={setShowReplace}
            onDismiss={() => {
              dismissFindBar();
            }}
            status={status}
          />
        ) : null}
        <GoToLineDialog
          open={goToState !== null}
          currentLine={goToState?.currentLine ?? 1}
          lineCount={goToState?.lineCount ?? 1}
          onSubmit={onGoToSubmit}
          onCancel={onGoToCancel}
        />
      </>
    ) : null;

  return { findBar, keymapCallbacks, editorExtensions, keymap };
}
