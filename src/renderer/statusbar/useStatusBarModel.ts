import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EncodingId, EolId, AnsiEncodingEntry } from '@shared/ipc-contract';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { MonacoHandle } from '../editor/MonacoEditor';
import type { TabsStore } from '../tabs/useTabsStore';
import type { StatusTheme } from './tokens';
import { type LineColumn } from './statusModel';
import type { FileModificationState, StatusBarProps } from './StatusBar';
import { recordLastSaved, getLastSaved, deriveModificationState } from './fileStatusTracker';
import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM } from '../editor/commands/logic/zoom';
import { getEditorZoom, applyEditorZoom, initEditorZoom } from '../editor/zoomRegistry';

/**
 * Derives StatusBarProps from the active tab and Monaco editor, binding actions
 * to the typed `window.notepads` bridge. Cursor and content updates are event-
 * driven; zoom is shared through the editor registry.
 */

// Re-exported so existing tests (useStatusBarModel.zoom.test.ts) and any host
// callers keep importing the zoom API from this module's path after the registry
// moved into editor/zoomRegistry.
export { initEditorZoom, applyEditorZoom, getEditorZoom };

// ---------------------------------------------------------------------------
//  Hook
// ---------------------------------------------------------------------------

export function useStatusBarModel(args: {
  theme: StatusTheme;
  store: TabsStore;
  getActiveHandle: () => MonacoHandle | null;
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
  const viewModePreview = tab?.viewMode?.preview ?? false;
  const viewModeDiff = tab?.viewMode?.diff ?? false;

  const [lineColumn, setLineColumn] = useState<LineColumn>({
    line: 1,
    column: 1,
    selectedCount: 0
  });
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_ZOOM);
  // True while the zoom slider is being dragged; pauses the poll read so the
  // optimistic per-move percentage is never clobbered mid-drag.
  const zoomDraggingRef = useRef(false);
  const [ansiEncodings, setAnsiEncodings] = useState<readonly AnsiEncodingEntry[]>([]);
  const [fileModificationSnapshot, setFileModificationSnapshot] = useState<{
    editorId: string | null;
    filePath: string | null;
    state: FileModificationState;
  }>({ editorId: activeEditorId, filePath, state: 'none' });
  // A tab switch must present the neutral state immediately, before the
  // asynchronous disk revalidation for the new tab completes.
  const fileModificationState =
    fileModificationSnapshot.editorId === activeEditorId &&
    fileModificationSnapshot.filePath === filePath
      ? fileModificationSnapshot.state
      : 'none';

  // Snapshot caret position + selection length from the active Monaco editor.
  const snapshotCaret = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor) => {
      const position = editor.getPosition();
      if (!position) return;
      const selection = editor.getSelection();
      const selectedCount =
        selection && !selection.isEmpty()
          ? (editor.getModel()?.getValueLengthInRange(selection) ?? 0)
          : 0;
      setLineColumn((prev) => {
        const l = position.lineNumber;
        const c = position.column;
        const s = selectedCount;
        return prev.line === l && prev.column === c && prev.selectedCount === s
          ? prev
          : { line: l, column: c, selectedCount: s };
      });
    },
    [] // intentionally stable — editor is passed in, not captured
  );

  // Subscribe to cursor/selection/content events on the active editor.
  // Re-fires whenever activeEditorId changes (new tab) so the new editor's
  // events are wired and stale subscriptions from the previous editor are disposed.
  useEffect(() => {
    const editor = getActiveHandle()?.getEditor();
    if (!editor) return;

    const cursorSub = editor.onDidChangeCursorPosition(() => snapshotCaret(editor));
    const selectionSub = editor.onDidChangeCursorSelection(() => snapshotCaret(editor));
    // Content change can affect selection length metrics; re-snapshot on change.
    const contentSub = editor.onDidChangeModelContent(() => snapshotCaret(editor));
    // Defer initial state updates out of this effect while retaining the same
    // mount/tab-switch snapshot and ensuring subscriptions are already active.
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      snapshotCaret(editor);
      if (!zoomDraggingRef.current) setZoomPercent(getEditorZoom(editor));
    });

    return () => {
      alive = false;
      cursorSub.dispose();
      selectionSub.dispose();
      contentSub.dispose();
    };
  }, [activeEditorId, getActiveHandle, snapshotCaret]);

  // Poll because Monaco exposes no event for external font-size changes; the
  // registry lookup is constant-time and avoids a second state authority.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (zoomDraggingRef.current) return;
      const editor = getActiveHandle()?.getEditor();
      if (editor) setZoomPercent(getEditorZoom(editor));
    }, 250);
    return () => window.clearInterval(id);
  }, [getActiveHandle, activeEditorId]);

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

  // --- column-0 external-modification state machine (UWP parity) -----------
  const activeIdRef = useRef<string | null>(activeEditorId);
  const activePathRef = useRef<string | null>(filePath);
  useLayoutEffect(() => {
    activeIdRef.current = activeEditorId;
    activePathRef.current = filePath;
  }, [activeEditorId, filePath]);

  const checkFileStatus = useCallback(async (): Promise<FileModificationState> => {
    const id = activeIdRef.current;
    const path = activePathRef.current;
    if (!id || path === null) {
      setFileModificationSnapshot({ editorId: id, filePath: path, state: 'none' });
      return 'none';
    }
    const r = await window.notepads.file.revalidatePath(path);
    const outcome = r.ok ? r.data : { exists: false, dateModifiedMs: 0 };
    const next = deriveModificationState(path, outcome, getLastSaved(id));
    if (activeIdRef.current === id && activePathRef.current === path) {
      setFileModificationSnapshot({ editorId: id, filePath: path, state: next });
    }
    return next;
  }, []);

  useEffect(() => {
    if (!activeEditorId || filePath === null) return;
    void checkFileStatus();
    const id = window.setInterval(() => void checkFileStatus(), 3000);
    return () => window.clearInterval(id);
  }, [activeEditorId, filePath, checkFileStatus]);


  const onReopenWithEncoding = useCallback(
    (id: EncodingId) => {
      if (filePath && !tab?.largeFile) void window.notepads.encoding.decodeWith(filePath, id);
    },
    [filePath, tab?.largeFile]
  );

  const reloadAndRebaseline = useCallback(async (id: string, path: string) => {
    // A large tab uses a streamed Piece Tree model; avoid a whole-file reload
    // through the small-file IPC path.
    if (store.get(id)?.largeFile) return;
    const r = await window.notepads.file.reloadFromDisk(path);
    if (r.ok) {
      recordLastSaved(id, path, r.data.dateModifiedMs);
      setFileModificationSnapshot({ editorId: id, filePath: path, state: 'none' });
    }
  }, [store]);

  // Slider/buttons → editor: write the zoom registry + updateOptions, update
  // local state optimistically so the flyout tracks the drag immediately.
  const applyZoom = useCallback(
    (percent: number) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent));
      setZoomPercent(clamped);
      const editor = getActiveHandle()?.getEditor();
      if (editor) applyEditorZoom(editor, clamped);
    },
    [getActiveHandle]
  );

  const onZoomDragStart = useCallback(() => {
    zoomDraggingRef.current = true;
  }, []);
  const onZoomDragEnd = useCallback(() => {
    zoomDraggingRef.current = false;
    const editor = getActiveHandle()?.getEditor();
    if (editor) setZoomPercent(getEditorZoom(editor));
  }, [getActiveHandle]);

  const activeEditor = getActiveHandle()?.getEditor();
  const renderedZoomPercent = activeEditor ? getEditorZoom(activeEditor) : zoomPercent;

  return useMemo<StatusBarProps>(
    () => ({
      theme,
      fileModificationState,
      filePath,
      fileNamePlaceholder: placeholder,
      isModified,
      lineColumn,
      zoomPercent: renderedZoomPercent,
      eolId,
      encodingId,
      ansiEncodings,
      isShadowWindow,
      viewMode: { preview: viewModePreview, diff: viewModeDiff },
      onSetViewMode: (mode) => {
        if (activeEditorId) store.setViewMode(activeEditorId, mode);
      },
      folderPath: null,
      onToggleFolder: () => {},
      onReloadFromDisk: () => {
        if (activeEditorId && filePath) void reloadAndRebaseline(activeEditorId, filePath);
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
            new CustomEvent('notepads:begin-rename', { detail: { editorId: activeEditorId } })
          );
        }
      },
      onPreviewChanges: () => {
        if (activeEditorId) store.setViewMode(activeEditorId, { preview: false, diff: true });
      },
      onRevertAllChanges: () => {
        if (activeEditorId && filePath) void reloadAndRebaseline(activeEditorId, filePath);
      },
      onGoToLine: () => {
        window.dispatchEvent(new CustomEvent('notepads:go-to-line'));
      },
      onSetZoom: applyZoom,
      onResetZoom: () => applyZoom(DEFAULT_ZOOM),
      onZoomDragStart,
      onZoomDragEnd,
      onChangeEol: (eol: EolId) => {
        if (activeEditorId) store.setLabels(activeEditorId, encodingId, eol);
      },
      onReopenWithEncoding,
      onSaveWithEncoding: (id: EncodingId) => {
        if (!filePath || !activeEditorId) return;
        void window.notepads.file.save({ filePath, encodingId: id }).then((r) => {
          if (r.ok) {
            recordLastSaved(activeEditorId, r.data.filePath, r.data.dateModifiedMs);
            setFileModificationSnapshot({
              editorId: activeEditorId,
              filePath,
              state: 'none'
            });
          }
        });
      }
    }),
    [
      theme,
      fileModificationState,
      filePath,
      placeholder,
      renderedZoomPercent,
      isModified,
      lineColumn,
      eolId,
      encodingId,
      ansiEncodings,
      isShadowWindow,
      viewModePreview,
      viewModeDiff,
      activeEditorId,
      store,
      onReopenWithEncoding,
      reloadAndRebaseline,
      applyZoom,
      onZoomDragStart,
      onZoomDragEnd
    ]
  );
}
