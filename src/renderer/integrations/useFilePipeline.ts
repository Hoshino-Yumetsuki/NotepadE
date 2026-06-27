import { useCallback } from 'react';
import type { TabsStore } from '../tabs/useTabsStore';
import type { MonacoHandle } from '../editor/MonacoEditor';
import { recordLastSaved } from '../statusbar/fileStatusTracker';
import { getTabTitle } from '../integrations/pathUtils';

interface UseFilePipelineProps {
  store: TabsStore;
  editorHandles: React.MutableRefObject<Map<string, MonacoHandle | null>>;
  lastSavedTextRef: React.MutableRefObject<Map<string, string>>;
  baselineRef: React.MutableRefObject<Map<string, { hash: number; length: number }>>;
  recomputeDirty: (editorId: string) => void;
}

export interface UseFilePipelineReturn {
  openPathIntoTab: (path: string) => void;
  doSave: (editorId: string, opts?: { saveAs?: boolean }) => Promise<boolean>;
  doSaveAll: () => Promise<void>;
}

export function useFilePipeline({
  store,
  editorHandles,
  lastSavedTextRef,
  baselineRef,
  recomputeDirty
}: UseFilePipelineProps): UseFilePipelineReturn {
  // Open an absolute path into a tab (the shared open primitive). If the path is
  // ALREADY open in this window, focus that tab instead of opening a duplicate
  // (UWP focuses the existing set) — two editors on one path would let the second
  // save silently clobber the first (edit-loss). Otherwise read via MAIN
  // (file.open), seed a fresh tab with the authoritative labels, and seed the
  // diff/dirty baseline BEFORE setDoc so the doc-change listener treats the loaded
  // text as the clean baseline (Issue 3) rather than '' (which would mark it
  // dirty). Used by activation-open, the Open dialog (Ctrl+O), the Open Recent
  // submenu, and drag-drop — every path that opens a file on disk.
  const openPathIntoTab = useCallback(
    (path: string): void => {
      const winNT = navigator.userAgent.includes('Windows');
      const norm = (p: string): string => (winNT ? p.toLowerCase() : p);
      const target = norm(path);
      const existing = store.tabs.find(
        (tab) => tab.filePath !== null && norm(tab.filePath) === target
      );
      if (existing) {
        store.activate(existing.editorId);
        return;
      }

      const s = store.tabs;
      const seedTab =
        s.length === 1 && s[0].filePath === null && !s[0].isModified && !s[0].isLoading
          ? s[0]
          : null;
      let id: string;
      if (seedTab) {
        id = seedTab.editorId;
        store.setFilePath(id, path);
        store.setLoading(id, true);
        store.activate(id);
      } else {
        id = store.newTab({ filePath: path, isLoading: true, activate: true });
      }

      const STREAM_THRESHOLD = 1_048_576; // 1MB

      void window.notepads.file.getSize(path).then((sizeRes) => {
        if (!store.get(id)) return;
        const fileSize = sizeRes.ok ? sizeRes.data : 0;

        if (fileSize < STREAM_THRESHOLD) {
          // Direct load path (small files)
          void window.notepads.file.open(path).then((res) => {
            if (!store.get(id)) return;
            if (!res.ok) {
              if (seedTab) {
                store.setFilePath(id, null);
                store.setLoading(id, false);
              } else {
                store.close(id);
                if (store.count() === 0) store.newTab();
              }
              return;
            }
            const normalized = res.data.decodedText;
            const seedOpened = (): void => {
              if (!store.get(id)) return;
              const handle = editorHandles.current.get(id);
              if (handle) handle.setDoc(normalized);
              else setTimeout(seedOpened, 0);
            };
            lastSavedTextRef.current.set(id, normalized);
            baselineRef.current.set(id, {
              hash: res.data.baselineHash,
              length: res.data.baselineLength
            });
            store.setLabels(id, res.data.encodingId, res.data.eolId);
            store.setFilePath(id, res.data.filePath);
            if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
            store.setLoading(id, false);
            seedOpened();
          });
        } else {
          // Streaming load path (large files)
          void (async () => {
            // Subscribe to chunk events BEFORE requesting streamed open
            const unlisten = await window.notepads.file.onChunk((chunk) => {
              if (!store.get(id)) {
                unlisten();
                return;
              }
              const handle = editorHandles.current.get(id);
              if (!handle) return;
              const editor = handle.getEditor();
              const model = editor?.getModel();
              if (!model) return;
              // Append the chunk at end-of-doc with NO undo step: model.applyEdits
              // does not push to the undo stack (unlike executeEdits /
              // pushEditOperations), so a streamed load can never be partially
              // un-done. Range = the empty range at the very end of the model.
              const end = model.getFullModelRange().getEndPosition();
              model.applyEdits([
                {
                  range: {
                    startLineNumber: end.lineNumber,
                    startColumn: end.column,
                    endLineNumber: end.lineNumber,
                    endColumn: end.column
                  },
                  text: chunk.text
                }
              ]);
              if (chunk.isLast) {
                unlisten();
                // Snapshot the fully-loaded text as the saved baseline for diff
                lastSavedTextRef.current.set(id, handle.getShadowText());
                // Enable editing now that the full document is loaded
                store.setStreaming(id, false);
                // Re-check dirty now that the doc is complete (streaming suppressed earlier checks)
                recomputeDirty(id);
              }
            });

            const res = await window.notepads.file.openStreamed(path);
            if (!store.get(id)) {
              unlisten();
              return;
            }
            if (!res.ok) {
              unlisten();
              if (seedTab) {
                store.setFilePath(id, null);
                store.setLoading(id, false);
              } else {
                store.close(id);
                if (store.count() === 0) store.newTab();
              }
              return;
            }
            const header = res.data;
            baselineRef.current.set(id, {
              hash: header.baselineHash,
              length: header.baselineLength
            });
            lastSavedTextRef.current.set(id, ''); // placeholder; re-read from disk for diff
            store.setLabels(id, header.encodingId, header.eolId);
            store.setFilePath(id, header.filePath);
            if (header.filePath) recordLastSaved(id, header.filePath, header.dateModifiedMs);
            // Show editor immediately (empty doc), mark as streaming (readOnly)
            store.setLoading(id, false);
            store.setStreaming(id, true);
          })();
        }
      });
    },
    [store, editorHandles, lastSavedTextRef, baselineRef, recomputeDirty]
  );

  // Save pipeline (Issue 3, UWP NotepadsMainPage.IO.cs:159-217). doSave writes the
  // active (or given) tab: untitled / no filePath / saveAs → native Save-As picker
  // (file.saveAs); else write the existing path (file.save). A plain Ctrl+S on an
  // unmodified, already-on-disk doc is a no-op. On success: re-baseline the shadow
  // text, set filePath + clear isModified (named tab title follows filePath).
  const doSave = useCallback(
    async (editorId: string, opts?: { saveAs?: boolean }): Promise<boolean> => {
      const tab = store.get(editorId);
      const handle = editorHandles.current.get(editorId);
      if (!tab || !handle) return false;
      const saveAs = opts?.saveAs ?? false;
      const shadowText = handle.getShadowText();
      const hasPath = !!tab.filePath;
      // No-op: a clean, already-saved file with a plain Ctrl+S writes nothing.
      if (!saveAs && hasPath && !tab.isModified) return true;

      const res =
        saveAs || !hasPath
          ? await window.notepads.file.saveAs({
              shadowText,
              encodingId: tab.encodingId,
              eolId: tab.eolId,
              suggestedName: getTabTitle(tab),
              // Save As on a file-backed tab starts in the file's CURRENT folder
              // (UWP FileSavePicker seeded SuggestedSaveFile). PA-8: no path
              // module in the renderer — slice the directory off the absolute
              // path INCLUSIVE of the last separator (so a drive-root file
              // yields "C:\", which path.join treats as absolute, not the
              // drive-relative "C:"); MAIN joins the name back on. Untitled
              // buffers pass undefined and MAIN anchors to Documents.
              defaultDir: ((): string | undefined => {
                if (!tab.filePath) return undefined;
                const sep = tab.filePath.search(/[\\/][^\\/]*$/);
                return sep >= 0 ? tab.filePath.slice(0, sep + 1) : undefined;
              })()
            })
          : await window.notepads.file.save({
              filePath: tab.filePath as string,
              shadowText,
              encodingId: tab.encodingId,
              eolId: tab.eolId
            });
      // Cancelled picker or write error: leave the tab dirty, surface nothing.
      if (!res.ok) return false;

      // Re-baseline to the JUST-saved shadow text so the doc is clean again, and
      // adopt the authoritative path + labels MAIN echoes back.
      lastSavedTextRef.current.set(editorId, shadowText);
      baselineRef.current.set(editorId, {
        hash: res.data.baselineHash,
        length: res.data.baselineLength
      });
      store.setFilePath(editorId, res.data.filePath);
      store.setLabels(editorId, res.data.encodingId, res.data.eolId);
      recordLastSaved(editorId, res.data.filePath, res.data.dateModifiedMs);
      store.setModified(editorId, false);
      return true;
    },
    [store, editorHandles, lastSavedTextRef, baselineRef]
  );

  // Save All (UWP: loop modified editors). Untitled modified buffers each open a
  // Save-As picker in turn. Sequential so the native dialogs don't stack; a
  // cancelled picker (doSave → false) aborts the remaining saves.
  const doSaveAll = useCallback(async (): Promise<void> => {
    for (const t of store.tabs) {
      if (t.isModified && !(await doSave(t.editorId))) break;
    }
  }, [store, doSave]);

  return { openPathIntoTab, doSave, doSaveAll };
}
