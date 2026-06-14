import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EncodingId, EolId, AnsiEncodingEntry } from '@shared/ipc-contract';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { MonacoHandle } from '../editor/MonacoEditor';
import type { NotepadsTestHook, StatusBarTestHook } from '../editor/test-hook';
import type { TabsStore } from '../tabs/useTabsStore';
import type { StatusTheme } from './tokens';
import { type LineColumn } from './statusModel';
import type { FileModificationState, StatusBarProps } from './StatusBar';
import { recordLastSaved, getLastSaved, deriveModificationState } from './fileStatusTracker';
import { DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM } from '../editor/commands/logic/zoom';
import { getEditorZoom, applyEditorZoom, initEditorZoom } from '../editor/zoomRegistry';

/**
 * useStatusBarModel — derives StatusBarProps from the active tab + its Monaco
 * editor and binds every action to window.notepads (PA-8: no fs/path; all IO via IPC).
 *
 * Caret/selection updates subscribe via Monaco's onDidChangeCursorPosition and
 * onDidChangeModelContent so they are event-driven rather than polled.
 * Zoom percent is tracked in the shared editor/zoomRegistry (a WeakMap keyed on
 * the editor instance), since Monaco has no CM6-style StateField for per-editor
 * state. The keyboard/wheel zoom commands write to the SAME registry so the status
 * bar slider always reflects keyboard-driven zoom and vice-versa.
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
  const [fileModificationState, setFileModificationState] = useState<FileModificationState>('none');

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

    // Initial snapshot on mount / tab switch.
    snapshotCaret(editor);
    if (!zoomDraggingRef.current) setZoomPercent(getEditorZoom(editor));

    const cursorSub = editor.onDidChangeCursorPosition(() => snapshotCaret(editor));
    const selectionSub = editor.onDidChangeCursorSelection(() => snapshotCaret(editor));
    // Content change can affect selection length metrics; re-snapshot on change.
    const contentSub = editor.onDidChangeModelContent(() => snapshotCaret(editor));

    return () => {
      cursorSub.dispose();
      selectionSub.dispose();
      contentSub.dispose();
    };
  }, [activeEditorId, getActiveHandle, snapshotCaret]);

  // Poll zoom every 250ms — zoom is still written externally by keyboard commands
  // (T3) via applyEditorZoom, and there is no Monaco event for font-size changes.
  // This poll is cheap (a WeakMap lookup) and matches the e2e settle cadence.
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
  activeIdRef.current = activeEditorId;
  activePathRef.current = filePath;

  const checkFileStatus = useCallback(async (): Promise<FileModificationState> => {
    const id = activeIdRef.current;
    const path = activePathRef.current;
    if (!id || path === null) {
      setFileModificationState('none');
      return 'none';
    }
    const r = await window.notepads.file.revalidatePath(path);
    const outcome = r.ok ? r.data : { exists: false, dateModifiedMs: 0 };
    const next = deriveModificationState(path, outcome, getLastSaved(id));
    if (activeIdRef.current === id && activePathRef.current === path) {
      setFileModificationState(next);
    }
    return next;
  }, []);

  useEffect(() => {
    setFileModificationState('none');
    if (!activeEditorId || filePath === null) return;
    void checkFileStatus();
    const id = window.setInterval(() => void checkFileStatus(), 3000);
    return () => window.clearInterval(id);
  }, [activeEditorId, filePath, checkFileStatus]);

  // Test seam: window.__notepadsTest.statusbar.checkFileStatus()
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seam: StatusBarTestHook = { checkFileStatus };
    const existing = window.__notepadsTest;
    if (existing) {
      existing.statusbar = seam;
    } else {
      window.__notepadsTest = { statusbar: seam } as unknown as NotepadsTestHook;
    }
    return () => {
      if (window.__notepadsTest) window.__notepadsTest.statusbar = undefined;
    };
  }, [checkFileStatus]);

  const onReopenWithEncoding = useCallback(
    (id: EncodingId) => {
      if (filePath) void window.notepads.encoding.decodeWith(filePath, id);
    },
    [filePath]
  );

  const reloadAndRebaseline = useCallback(async (id: string, path: string) => {
    const r = await window.notepads.file.reloadFromDisk(path);
    if (r.ok) {
      recordLastSaved(id, path, r.data.dateModifiedMs);
      setFileModificationState('none');
    }
  }, []);

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

  return useMemo<StatusBarProps>(
    () => ({
      theme,
      fileModificationState,
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
            setFileModificationState('none');
          }
        });
      }
    }),
    [
      theme,
      fileModificationState,
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
      reloadAndRebaseline,
      applyZoom,
      onZoomDragStart,
      onZoomDragEnd
    ]
  );
}
