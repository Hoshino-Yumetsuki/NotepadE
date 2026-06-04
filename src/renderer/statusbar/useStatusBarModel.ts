import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EncodingId, EolId, AnsiEncodingEntry } from '@shared/ipc-contract';
import type { CodeMirrorHandle } from '../editor/CodeMirrorEditor';
import type { TabsStore } from '../tabs/useTabsStore';
import type { StatusTheme } from './tokens';
import { computeLineColumn, type LineColumn } from './statusModel';
import type { FileModificationState, StatusBarProps } from './StatusBar';

/**
 * useStatusBarModel — derives StatusBarProps from the active tab + its CM6 view
 * and binds every action to window.notepads (PA-8: no fs/path; all IO via IPC).
 *
 * The host (App) passes the active editor handle resolver, the tabs store, and
 * the resolved theme. Encoding/EOL labels are read from the active tab OPAQUE
 * (never re-derived). Line/column is computed from the active editor's '\n'
 * shadow doc + selection. The ANSI list is fetched once from MAIN for the
 * "More encodings" submenu; a fetch failure leaves it empty (Unicode rows still
 * show), matching the contract's stubbed-namespace behavior.
 */
export function useStatusBarModel(args: {
  theme: StatusTheme;
  store: TabsStore;
  getActiveHandle: () => CodeMirrorHandle | null;
  activeEditorId: string | null;
  isShadowWindow?: boolean;
}): StatusBarProps {
  const { theme, store, getActiveHandle, activeEditorId, isShadowWindow = false } = args;

  const tab = activeEditorId ? store.get(activeEditorId) : undefined;
  const filePath = tab?.filePath ?? null;
  const isModified = tab?.isModified ?? false;
  const encodingId: EncodingId = tab?.encodingId ?? 'UTF-8';
  const eolId: EolId = tab?.eolId ?? 'crlf';
  const placeholder = tab?.untitledName || 'Untitled';

  const [lineColumn, setLineColumn] = useState<LineColumn>({ line: 1, column: 1, selectedCount: 0 });
  const [zoomPercent, setZoomPercent] = useState(100);
  const [ansiEncodings, setAnsiEncodings] = useState<readonly AnsiEncodingEntry[]>([]);

  // Recompute Ln/Col from the active editor's '\n' doc + main selection.
  const refreshCaret = useCallback(() => {
    const view = getActiveHandle()?.getView();
    if (!view) return;
    const doc = view.state.doc.toString();
    const { from, to } = view.state.selection.main;
    setLineColumn(computeLineColumn(doc, { from, to }));
  }, [getActiveHandle]);

  useEffect(() => {
    refreshCaret();
    const id = window.setInterval(refreshCaret, 250);
    return () => window.clearInterval(id);
  }, [refreshCaret, activeEditorId]);

  // Pull the ANSI table once for the "More encodings" submenu.
  useEffect(() => {
    let alive = true;
    void window.notepads.encoding.listAnsi().then((r) => {
      if (alive && r.ok) setAnsiEncodings(r.data);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onReopenWithEncoding = useCallback(
    (id: EncodingId) => {
      if (filePath) void window.notepads.encoding.decodeWith(filePath, id);
    },
    [filePath],
  );

  return useMemo<StatusBarProps>(
    () => ({
      theme,
      fileModificationState: 'none' as FileModificationState,
      filePath,
      fileNamePlaceholder: placeholder,
      isModified,
      lineColumn,
      zoomPercent,
      eolId,
      encodingId,
      ansiEncodings,
      isShadowWindow,
      onReloadFromDisk: () => {
        if (filePath) void window.notepads.file.reloadFromDisk(filePath);
      },
      onCopyFullPath: () => {
        if (filePath) void window.notepads.shell.copyPath(filePath);
      },
      onOpenContainingFolder: () => {
        if (filePath) void window.notepads.shell.openContainingFolder(filePath);
      },
      onRename: () => {
        if (activeEditorId) {
          window.dispatchEvent(
            new CustomEvent('notepads:begin-rename', { detail: { editorId: activeEditorId } }),
          );
        }
      },
      onPreviewChanges: () => {
        if (activeEditorId) store.setViewMode(activeEditorId, { preview: false, diff: true });
      },
      onRevertAllChanges: () => {
        if (activeEditorId && filePath) void window.notepads.file.reloadFromDisk(filePath);
      },
      onGoToLine: () => {
        window.dispatchEvent(new CustomEvent('notepads:go-to-line'));
      },
      onSetZoom: (percent: number) => setZoomPercent(percent),
      onResetZoom: () => setZoomPercent(100),
      onChangeEol: (eol: EolId) => {
        if (activeEditorId) store.setLabels(activeEditorId, encodingId, eol);
      },
      onReopenWithEncoding,
      onSaveWithEncoding: (id: EncodingId) => {
        if (filePath) void window.notepads.file.save({ filePath, encodingId: id });
      },
    }),
    [
      theme,
      filePath,
      placeholder,
      isModified,
      lineColumn,
      zoomPercent,
      eolId,
      encodingId,
      ansiEncodings,
      isShadowWindow,
      activeEditorId,
      store,
      onReopenWithEncoding,
    ],
  );
}
