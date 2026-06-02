import type { TabsStore } from './useTabsStore';
import type { NotepadsTestHook } from '../editor/test-hook';

/**
 * ============================================================================
 *  Tabs test seam (Phase 2) — window.__notepadsTest.tabs
 * ============================================================================
 *
 * The Playwright matrix (tabs-harness, stream D) drives the REAL store through
 * this seam. It is PA-8 clean: it adds NO new IPC surface and composes only the
 * in-renderer TabsStore actions the UI itself calls — so every mutator exercises
 * the genuine code path (safe as test preconditions, no shadow logic).
 *
 * Reads (list/activeId) are synchronous against the store's snapshot so Playwright
 * can assert state without waiting on a React render.
 */

/** Read-only projection of a tab for the harness (mirrors the DOM contract). */
export interface TabInfo {
  editorId: string;
  /** Basename of filePath, else the untitled display name (what the tab shows). */
  title: string;
  filePath: string | null;
  encodingId: string;
  eolId: 'crlf' | 'cr' | 'lf';
  isModified: boolean;
  active: boolean;
}

export interface TabsTestHook {
  /** All tabs in render order. */
  list(): TabInfo[];
  /** The active editorId, or null. */
  activeId(): string | null;
  /** Number of open tabs. */
  count(): number;

  // --- real-path mutators (same actions the UI invokes) ------------------
  newTab(args?: { filePath?: string | null; untitledName?: string }): string;
  activate(editorId: string): void;
  close(editorId: string): void;
  closeOthers(editorId: string): void;
  closeToRight(editorId: string): void;
  closeSaved(): void;
  reorder(fromIndex: number, toIndex: number): void;
  next(): void;
  prev(): void;
  jumpTo(oneBased: number): void;
  setModified(editorId: string, isModified: boolean): void;
  rename(editorId: string, name: string): void;
}

function titleOf(filePath: string | null, untitledName: string): string {
  if (filePath === null) return untitledName || 'Untitled';
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Install `window.__notepadsTest.tabs`, bound to the live store. Returns an
 * uninstall function. Coexists with the editor test hook (installTestHook):
 * both write to the same `window.__notepadsTest` object.
 */
export function installTabsTestHook(store: TabsStore): () => void {
  if (typeof window === 'undefined') return () => {};

  const tabs: TabsTestHook = {
    list: () =>
      store.tabs.map((t) => ({
        editorId: t.editorId,
        title: titleOf(t.filePath, t.untitledName),
        filePath: t.filePath,
        encodingId: t.encodingId,
        eolId: t.eolId,
        isModified: t.isModified,
        active: t.editorId === store.activeEditorId,
      })),
    activeId: () => store.activeEditorId,
    count: () => store.count(),
    newTab: (args) => store.newTab(args),
    activate: (editorId) => store.activate(editorId),
    close: (editorId) => store.close(editorId),
    closeOthers: (editorId) => store.closeOthers(editorId),
    closeToRight: (editorId) => store.closeToRight(editorId),
    closeSaved: () => store.closeSaved(),
    reorder: (fromIndex, toIndex) => store.reorder(fromIndex, toIndex),
    next: () => store.next(),
    prev: () => store.prev(),
    jumpTo: (oneBased) => store.jumpTo(oneBased),
    setModified: (editorId, isModified) => store.setModified(editorId, isModified),
    rename: (editorId, name) => {
      const tab = store.get(editorId);
      if (!tab) return;
      if (tab.filePath === null) store.setUntitledName(editorId, name);
    },
  };

  const existing = window.__notepadsTest;
  if (existing) {
    existing.tabs = tabs;
  } else {
    // Editor hook not installed yet; stash a partial so tabs are still reachable.
    // installTestHook (editor) will Object.assign over this, preserving `tabs`.
    window.__notepadsTest = { tabs } as unknown as NotepadsTestHook;
  }

  return () => {
    if (window.__notepadsTest) delete window.__notepadsTest.tabs;
  };
}
