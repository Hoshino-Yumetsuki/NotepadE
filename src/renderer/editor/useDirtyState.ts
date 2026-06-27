import { useRef, useCallback } from 'react';
import type { TabsStore } from '../tabs/useTabsStore';
import type { MonacoHandle } from './MonacoEditor';

export interface UseDirtyStateReturn {
  lastSavedTextRef: React.MutableRefObject<Map<string, string>>;
  baselineRef: React.MutableRefObject<Map<string, { hash: number; length: number }>>;
  recomputeDirty: (editorId: string) => void;
}

/**
 * Custom hook managing baseline texts and hashes for dirty state detection (Issue 3).
 * Compares the live '\n'-shadow text to that tab's last-saved baseline.
 */
export function useDirtyState(
  store: TabsStore,
  editorHandles: React.MutableRefObject<Map<string, MonacoHandle | null>>
): UseDirtyStateReturn {
  // Last-saved baseline TEXT per editor (Phase 6, diff viewer). The store/tracker
  // keep only mtime, so the diff pane's "original" column needs the text captured
  // at each authoritative load point (open / activation-open / adopt). Untitled
  // buffers have no entry → '' (everything shows as an insert). Pure renderer.
  // INVARIANT: entries are stored ALREADY '\n'-shadow-normalized (every writer
  // normalizes at set time). recomputeDirty runs on EVERY doc change; normalizing
  // a raw CRLF baseline there instead would re-build a full copy of the string
  // per keystroke (~190ms + ~120MB transient on a 120MB file — measured).
  const lastSavedTextRef = useRef<Map<string, string>>(new Map());

  // Hash-based dirty detection: avoids materializing the full doc string on every
  // keystroke when lengths happen to match. The hash is computed in Rust (xxh3_64).
  const baselineRef = useRef<Map<string, { hash: number; length: number }>>(new Map());

  // Recompute a tab's dirty flag (Issue 3): compare the live '\n'-shadow text to
  // that tab's last-saved baseline. The baseline map stores entries ALREADY
  // shadow-normalized (see lastSavedTextRef), so no normalize pass runs here —
  // this fires on EVERY doc change, and re-normalizing a 120MB baseline per
  // keystroke costs ~190ms + a full-size transient copy (measured). Untitled
  // buffers have no baseline entry → '' (any typed character makes them dirty).
  // Drives the tab dot + status-bar "Modified" via store.setModified.
  const recomputeDirty = useCallback(
    (editorId: string): void => {
      const handle = editorHandles.current.get(editorId);
      if (!handle) return;
      const model = handle.getEditor()?.getModel();
      if (!model) return;
      // Length in the LF shadow buffer WITHOUT materializing the whole string
      // (Monaco computes it from the buffer's internal metrics). Matches the
      // baseline length, which Rust computed over the same '\n'-normalized text.
      const shadowLength = model.getValueLength(1 /* EndOfLinePreference.LF */);
      const bl = baselineRef.current.get(editorId);
      // Untitled buffers have no baseline → any content makes them dirty.
      if (!bl) {
        store.setModified(editorId, shadowLength > 0);
        return;
      }
      // Length fast-path: most edits change length.
      if (shadowLength !== bl.length) {
        store.setModified(editorId, true);
        return;
      }
      // Same length (e.g. overtype / replace-selection with equal length): a
      // content change that ties the baseline length is almost always a real
      // edit. Reflect dirty OPTIMISTICALLY and immediately so the tab dot +
      // status bar respond at once, THEN reconcile against the baseline hash —
      // on a multi-MB file getShadowText() materializes the whole string and the
      // hash round-trips through IPC (seconds), which previously left the dirty
      // state lagging behind the edit. The hash only ever CLEARS it back (when
      // the user restored the exact saved text).
      store.setModified(editorId, true);
      const text = handle.getShadowText();
      void window.notepads.hash.compute(text).then((res) => {
        if (!res.ok) return;
        store.setModified(editorId, res.data !== bl.hash);
      });
    },
    [store, editorHandles]
  );

  return { lastSavedTextRef, baselineRef, recomputeDirty };
}
