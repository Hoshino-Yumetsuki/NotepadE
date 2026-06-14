/**
 * Find-bar host hook (RENDERER, Lane B) — Monaco edition.
 *
 * Replaces the CM6 version. The React FindBar / GoToLineDialog widgets are
 * unchanged. The only difference from the caller's perspective:
 *   - `getActiveView: () => EditorView | null`  →
 *     `getActiveEditor: () => IStandaloneCodeEditor | null`
 *   - `editorExtensions` is gone (Monaco has no CM6 Extension array; highlights
 *     are applied via deltaDecorations directly on the editor instance).
 *   - `keymap` is gone; replaced by `registerFindKeybindings(editor, cb)` which
 *     the MonacoEditor component calls once on mount.
 *
 * Everything else (open/close state, query ref, find/replace actions, GoToLine,
 * status formatting) is identical to the CM6 version.
 *
 * PA-8: renderer-only; touches the IStandaloneCodeEditor + DOM, never IPC/fs.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api';
import { FindBar, type FindDirection } from './FindBar';
import type { SearchOptions } from './searchEngine';
import {
  type FindQuery,
  type FindOutcome,
  findNextInEditor,
  findPreviousInEditor,
  replaceOne,
  replaceAllInEditor,
  goToLine,
  refreshHighlights,
  clearHighlights
} from './findController';
import { type FindKeymapCallbacks } from './findKeymap';
import { GoToLineDialog } from './GoToLineDialog';
import { useT, type Translator } from '../../i18n';

/** What the App must provide: a getter for the currently-active Monaco editor. */
export interface UseFindBarOptions {
  /** The active tab's live IStandaloneCodeEditor, or null when none is focused. */
  getActiveEditor: () => monacoApi.editor.IStandaloneCodeEditor | null;
}

/** What the hook hands back to the App shell. */
export interface FindBarHost {
  /** The find bar element to render (null when the bar is closed). */
  findBar: JSX.Element | null;
  /** Callbacks the Monaco keybindings need (Ctrl+F/H/G, F3/Shift+F3, Esc). */
  keymapCallbacks: FindKeymapCallbacks;
}

/** Format the UWP-style "wrapped" / "No results" status text. */
function formatStatus(
  outcome: FindOutcome | null,
  hasQuery: boolean,
  t: Translator['t']
): string | undefined {
  if (!hasQuery) return undefined;
  if (!outcome || !outcome.match) return t('FindAndReplace_NotificationMsg_NotFound');
  return outcome.wrapped ? 'Wrapped' : undefined;
}

export function useFindBar(opts: UseFindBarOptions): FindBarHost {
  const { getActiveEditor } = opts;

  const { t } = useT();

  const [open, setOpen] = useState<boolean>(false);
  const [showReplace, setShowReplace] = useState<boolean>(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [seedKey, setSeedKey] = useState<number>(0);

  const [goToState, setGoToState] = useState<{ currentLine: number; lineCount: number } | null>(
    null
  );

  const activeQueryRef = useRef<FindQuery | null>(null);

  const toQuery = (query: string, options: SearchOptions): FindQuery => ({ query, ...options });

  // --- Open / dismiss --------------------------------------------------------

  const openFindBar = useCallback((replace: boolean) => {
    setShowReplace(replace);
    setOpen(true);
    setSeedKey((k) => k + 1);
  }, []);

  const dismissFindBar = useCallback((): boolean => {
    if (!open) return false;
    setOpen(false);
    setStatus(undefined);
    const editor = getActiveEditor();
    if (editor) {
      clearHighlights(editor);
      editor.focus();
    }
    return true;
  }, [open, getActiveEditor]);

  const openGoToLine = useCallback(() => {
    const editor = getActiveEditor();
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const pos = editor.getPosition();
    const currentLine = pos?.lineNumber ?? 1;
    setGoToState({ currentLine, lineCount: model.getLineCount() });
  }, [getActiveEditor]);

  const onGoToSubmit = useCallback(
    (line: number) => {
      setGoToState(null);
      const editor = getActiveEditor();
      if (!editor) return;
      goToLine(editor, line);
      editor.focus();
    },
    [getActiveEditor]
  );

  const onGoToCancel = useCallback(() => {
    setGoToState(null);
    getActiveEditor()?.focus();
  }, [getActiveEditor]);

  // --- Live query change (highlight refresh) ---------------------------------

  const onQueryChange = useCallback(
    (query: string, options: SearchOptions) => {
      const q = toQuery(query, options);
      activeQueryRef.current = query.length > 0 ? q : null;
      const editor = getActiveEditor();
      if (!editor) return;
      refreshHighlights(editor, q);
      if (query.length === 0) setStatus(undefined);
    },
    [getActiveEditor]
  );

  // --- Find / replace actions ------------------------------------------------

  const onFind = useCallback(
    (query: string, options: SearchOptions, direction: FindDirection) => {
      const editor = getActiveEditor();
      if (!editor) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const outcome =
        direction === 'next' ? findNextInEditor(editor, q) : findPreviousInEditor(editor, q);
      setStatus(formatStatus(outcome, query.length > 0, t));
    },
    [getActiveEditor, t]
  );

  const onReplaceOne = useCallback(
    (query: string, options: SearchOptions, replacement: string, _direction: FindDirection) => {
      const editor = getActiveEditor();
      if (!editor) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const did = replaceOne(editor, q, replacement);
      setStatus(did ? undefined : t('FindAndReplace_NotificationMsg_NotFound'));
      refreshHighlights(editor, q);
    },
    [getActiveEditor, t]
  );

  const onReplaceAll = useCallback(
    (query: string, options: SearchOptions, replacement: string) => {
      const editor = getActiveEditor();
      if (!editor) return;
      const q = toQuery(query, options);
      activeQueryRef.current = q;
      const count = replaceAllInEditor(editor, q, replacement);
      setStatus(count > 0 ? `Replaced ${count}` : t('FindAndReplace_NotificationMsg_NotFound'));
      refreshHighlights(editor, q);
    },
    [getActiveEditor, t]
  );

  // --- Keymap callbacks ------------------------------------------------------

  const keymapCallbacks = useMemo<FindKeymapCallbacks>(
    () => ({
      openFindBar,
      dismissFindBar,
      openGoToLine,
      getActiveQuery: () => activeQueryRef.current
    }),
    [openFindBar, dismissFindBar, openGoToLine]
  );

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

  return { findBar, keymapCallbacks };
}
