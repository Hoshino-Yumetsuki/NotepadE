import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EncodingId, EolId, AnsiEncodingEntry } from '@shared/ipc-contract';
import type { CodeMirrorHandle } from '../editor/CodeMirrorEditor';
import type { NotepadsTestHook, StatusBarTestHook } from '../editor/test-hook';
import type { TabsStore } from '../tabs/useTabsStore';
import type { StatusTheme } from './tokens';
import { type LineColumn } from './statusModel';
import type { FileModificationState, StatusBarProps } from './StatusBar';
import { recordLastSaved, getLastSaved, deriveModificationState } from './fileStatusTracker';

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

  const [lineColumn, setLineColumn] = useState<LineColumn>({
    line: 1,
    column: 1,
    selectedCount: 0
  });
  const [zoomPercent, setZoomPercent] = useState(100);
  const [ansiEncodings, setAnsiEncodings] = useState<readonly AnsiEncodingEntry[]>([]);
  // Column-0 external-modification state machine (Gate-4 line 3).
  const [fileModificationState, setFileModificationState] = useState<FileModificationState>('none');

  // Recompute Ln/Col from the active editor's main selection. Uses CM6's
  // doc.lineAt (O(log n) line-tree lookup) on the selection START offset instead
  // of serializing the whole document (view.state.doc.toString()) + scanning it
  // char-by-char — the displayed Ln/Col is identical (the editor pins its line
  // separator to the '\n' shadow buffer, so offset/line/column arithmetic matches
  // computeLineColumn exactly), but the per-tick cost no longer scales with doc
  // length. `from`/`to` are the already-sorted main range; START is `from`.
  const refreshCaret = useCallback(() => {
    const view = getActiveHandle()?.getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const startLine = view.state.doc.lineAt(from);
    const next: LineColumn = {
      line: startLine.number,
      column: from - startLine.from + 1,
      selectedCount: to - from
    };
    // Bail when unchanged so the 250ms poll doesn't re-render every tick (and so
    // an unstable getActiveHandle can never drive a setState→render→setState loop).
    setLineColumn((prev) =>
      prev.line === next.line &&
      prev.column === next.column &&
      prev.selectedCount === next.selectedCount
        ? prev
        : next
    );
  }, [getActiveHandle]);

  // Drive Ln/Col from caret/selection movement. The 250ms poll is retained as the
  // settle mechanism the e2e statusbar driver waits on (it seeds a doc + selection
  // then waits ~250ms before asserting "Ln x, Col y"); the editor view is owned by
  // CodeMirrorEditor, so the status bar cannot mount its own CM6 updateListener
  // without remounting that view. The expensive part — full-doc serialization — is
  // gone (see refreshCaret above), so the remaining poll is a cheap O(log n) read.
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

  // --- column-0 external-modification state machine (UWP parity) -----------
  // Live refs so the test seam + interval always see the CURRENT active tab,
  // not a stale render closure. Only the ACTIVE file-backed tab is checked.
  const activeIdRef = useRef<string | null>(activeEditorId);
  const activePathRef = useRef<string | null>(filePath);
  activeIdRef.current = activeEditorId;
  activePathRef.current = filePath;

  // Force one synchronous check against disk: revalidate the active file-backed
  // tab and map the outcome vs its last-saved baseline. Untitled/no-path → 'none'.
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
    // Guard against a tab switch racing the await: only commit if still active.
    if (activeIdRef.current === id && activePathRef.current === path) {
      setFileModificationState(next);
    }
    return next;
  }, []);

  // Poll the active tab ~every 3s (UWP CheckAndUpdateFileStatusAsync cadence).
  // Reset to 'none' immediately on tab switch; an untitled tab never polls.
  useEffect(() => {
    setFileModificationState('none');
    if (!activeEditorId || filePath === null) return;
    void checkFileStatus();
    const id = window.setInterval(() => void checkFileStatus(), 3000);
    return () => window.clearInterval(id);
  }, [activeEditorId, filePath, checkFileStatus]);

  // Test seam: window.__notepadsTest.statusbar.checkFileStatus() forces a check
  // synchronously (the e2e cannot wait on the 3s timer). PA-8 clean — it only
  // composes window.notepads.file.revalidatePath + the renderer state machine.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seam: StatusBarTestHook = { checkFileStatus };
    const existing = window.__notepadsTest;
    if (existing) {
      existing.statusbar = seam;
    } else {
      // Editor/tabs hooks not installed yet; stash a partial so the seam is
      // reachable. installTestHook preserves sibling seams via Object semantics.
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

  // Reload from disk, then re-baseline the last-saved mtime from the fresh
  // OpenedFile so the indicator returns to 'none' (UWP resets state on reload).
  const reloadAndRebaseline = useCallback(async (id: string, path: string) => {
    const r = await window.notepads.file.reloadFromDisk(path);
    if (r.ok) {
      recordLastSaved(id, path, r.data.dateModifiedMs);
      setFileModificationState('none');
    }
  }, []);

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
      onSetZoom: (percent: number) => setZoomPercent(percent),
      onResetZoom: () => setZoomPercent(100),
      onChangeEol: (eol: EolId) => {
        if (activeEditorId) store.setLabels(activeEditorId, encodingId, eol);
      },
      onReopenWithEncoding,
      onSaveWithEncoding: (id: EncodingId) => {
        if (!filePath || !activeEditorId) return;
        void window.notepads.file.save({ filePath, encodingId: id }).then((r) => {
          // Re-baseline from the SaveResult mtime so a save clears the indicator.
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
      reloadAndRebaseline
    ]
  );
}
