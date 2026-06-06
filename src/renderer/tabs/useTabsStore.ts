import { useSyncExternalStore, useMemo } from 'react';
import {
  type TabState,
  type TabsSnapshot,
  type ViewMode,
  DEFAULT_ENCODING_ID,
  DEFAULT_EOL_ID,
  DEFAULT_VIEW_MODE,
  ZERO_CARET,
  ZERO_SCROLL,
} from './types';
import type { EncodingId, EolId } from '@shared/ipc-contract';

/**
 * ============================================================================
 *  Tabs store — multi-editor lifecycle (Phase 2, stream B)
 * ============================================================================
 *
 * docs/plan/03-phase-2-tabs-setsview.md tasks #4 (state model) + #5 (lifecycle).
 *
 * A tiny framework-agnostic store (no external dep) exposing the SetsView
 * operations with 1:1 UWP semantics:
 *   - new / activate / close
 *   - closeOthers / closeToRight / closeSaved   (TabContextFlyout.cs)
 *   - reorder (drag)                            (CanReorderItems)
 *   - next / prev (Ctrl+Tab / Ctrl+Shift+Tab)   — wraps around
 *   - jumpTo (Ctrl+1..9)                        — 1-based, 9 == LAST tab
 *   - setModified / setFilePath / setLabels / setViewMode / setCaret / setScroll
 *
 * The store is a module-level singleton so the Playwright test seam can read a
 * synchronous snapshot (getSnapshot) without touching React. The React hook
 * (useTabsStore) subscribes via useSyncExternalStore for tear-free renders.
 *
 * Close semantics (UWP NotepadsCore): closing the ACTIVE tab activates its
 * right neighbour if one exists, else the new last tab. Closing a non-active
 * tab leaves the active selection unchanged.
 */

let editorSeq = 0;
let untitledSeq = 0;

/**
 * Base name for untitled buffers (Issue: localized new-file name). Defaults to
 * the English 'Untitled' so the framework-agnostic store needs no i18n; the App
 * overrides it from the localized TextEditor_DefaultNewFileName resource (e.g.
 * '新建文本文档', '無題', 'Unbenannt') via setUntitledBaseName, so a new tab is
 * named in the active UI language instead of always English. The numbered suffix
 * ('{base} {N}') is preserved across locales.
 */
let untitledBaseName = 'Untitled';

/** Mint a process-unique editor id. */
function nextEditorId(): string {
  editorSeq += 1;
  return `editor-${editorSeq}`;
}

/** Arguments for opening/creating a tab. */
export interface NewTabArgs {
  filePath?: string | null;
  encodingId?: EncodingId;
  eolId?: EolId;
  isModified?: boolean;
  /** Force a specific editorId (used by session restore). */
  editorId?: string;
  /** Override the untitled display name (else "Untitled {N}"). */
  untitledName?: string;
  /** Insert at this index; defaults to the end. */
  index?: number;
  /** Activate the new tab after insert (default true). */
  activate?: boolean;
}

interface InternalState {
  tabs: TabState[];
  activeEditorId: string | null;
}

/** Build a fresh untitled tab record. */
function makeTab(args: NewTabArgs): TabState {
  const filePath = args.filePath ?? null;
  let untitledName = args.untitledName;
  if (filePath === null && untitledName === undefined) {
    untitledSeq += 1;
    untitledName = `${untitledBaseName} ${untitledSeq}`;
  }
  return {
    editorId: args.editorId ?? nextEditorId(),
    filePath,
    encodingId: args.encodingId ?? DEFAULT_ENCODING_ID,
    eolId: args.eolId ?? DEFAULT_EOL_ID,
    isModified: args.isModified ?? false,
    viewMode: { ...DEFAULT_VIEW_MODE },
    caret: { ...ZERO_CARET },
    scroll: { ...ZERO_SCROLL },
    untitledName: untitledName ?? '',
  };
}

/**
 * The TabsStore — a minimal observable. Snapshot is immutable; every mutation
 * produces a new `tabs` array + snapshot object so React + the seam both see a
 * referentially-stable value that changes only when content changes.
 */
export class TabsStore {
  private state: InternalState = { tabs: [], activeEditorId: null };
  private snapshot: TabsSnapshot = { tabs: [], activeEditorId: null };
  private listeners = new Set<() => void>();

  // --- subscription plumbing (useSyncExternalStore + test seam) ------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Synchronous, referentially-stable snapshot. */
  getSnapshot = (): TabsSnapshot => this.snapshot;

  private commit(next: InternalState): void {
    this.state = next;
    this.snapshot = { tabs: next.tabs, activeEditorId: next.activeEditorId };
    for (const l of this.listeners) l();
  }

  // --- queries -------------------------------------------------------------

  get tabs(): readonly TabState[] {
    return this.state.tabs;
  }

  get activeEditorId(): string | null {
    return this.state.activeEditorId;
  }

  indexOf(editorId: string): number {
    return this.state.tabs.findIndex((t) => t.editorId === editorId);
  }

  /**
   * Mint a fresh, renderer-unique editorId WITHOUT creating a tab. Used by the
   * cross-window adopt path: editorSeq is per-renderer, so a transferred tab's
   * source id can collide with an unrelated tab in the target window. The target
   * re-keys the adopted tab under a fresh local id from this same namespace.
   */
  mintEditorId(): string {
    let id = nextEditorId();
    // editorSeq advances independently of explicitly-forced ids (session restore,
    // adopt), so guard against a fresh id that happens to match an existing tab.
    while (this.indexOf(id) !== -1) id = nextEditorId();
    return id;
  }

  get(editorId: string): TabState | undefined {
    return this.state.tabs.find((t) => t.editorId === editorId);
  }

  count(): number {
    return this.state.tabs.length;
  }

  // --- lifecycle: create / activate / close --------------------------------

  /** Create (open) a tab. Returns the new editorId. */
  newTab(args: NewTabArgs = {}): string {
    const tab = makeTab(args);
    const tabs = this.state.tabs.slice();
    const at = args.index ?? tabs.length;
    const clamped = Math.max(0, Math.min(at, tabs.length));
    tabs.splice(clamped, 0, tab);
    const activate = args.activate ?? true;
    this.commit({
      tabs,
      activeEditorId: activate ? tab.editorId : this.state.activeEditorId,
    });
    return tab.editorId;
  }

  /** Make `editorId` the active tab (no-op if absent or already active). */
  activate(editorId: string): void {
    if (this.indexOf(editorId) === -1) return;
    if (this.state.activeEditorId === editorId) return;
    this.commit({ tabs: this.state.tabs, activeEditorId: editorId });
  }

  /**
   * Close one tab. UWP rule: if it was active, select the right neighbour, else
   * the new last tab; if it was not active, keep the current selection.
   */
  close(editorId: string): void {
    const idx = this.indexOf(editorId);
    if (idx === -1) return;
    const tabs = this.state.tabs.slice();
    tabs.splice(idx, 1);

    let active = this.state.activeEditorId;
    if (active === editorId) {
      if (tabs.length === 0) {
        active = null;
      } else {
        // Right neighbour sat at the same index after splice; else last tab.
        const nextIdx = Math.min(idx, tabs.length - 1);
        active = tabs[nextIdx].editorId;
      }
    }
    this.commit({ tabs, activeEditorId: active });
  }

  /** Close every tab EXCEPT `editorId`; it becomes active. */
  closeOthers(editorId: string): void {
    const keep = this.get(editorId);
    if (!keep) return;
    this.commit({ tabs: [keep], activeEditorId: keep.editorId });
  }

  /** Close every tab to the RIGHT of `editorId` (UWP "Close to the Right"). */
  closeToRight(editorId: string): void {
    const idx = this.indexOf(editorId);
    if (idx === -1) return;
    const tabs = this.state.tabs.slice(0, idx + 1);
    let active = this.state.activeEditorId;
    // If the active tab was among those removed, fall back to the anchor.
    if (active !== null && !tabs.some((t) => t.editorId === active)) {
      active = editorId;
    }
    this.commit({ tabs, activeEditorId: active });
  }

  /** Close every NON-modified (saved) tab (UWP "Close Saved"). */
  closeSaved(): void {
    const tabs = this.state.tabs.filter((t) => t.isModified);
    let active = this.state.activeEditorId;
    if (active !== null && !tabs.some((t) => t.editorId === active)) {
      active = tabs.length > 0 ? tabs[tabs.length - 1].editorId : null;
    }
    this.commit({ tabs, activeEditorId: active });
  }

  /** Close all tabs. */
  closeAll(): void {
    this.commit({ tabs: [], activeEditorId: null });
  }

  // --- reorder (drag) ------------------------------------------------------

  /** Move the tab at `from` to `to` (array-move). Active selection preserved. */
  reorder(from: number, to: number): void {
    const n = this.state.tabs.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    const tabs = this.state.tabs.slice();
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    this.commit({ tabs, activeEditorId: this.state.activeEditorId });
  }

  /** Reorder by editorId (dnd-kit gives ids, not indices). */
  reorderById(activeId: string, overId: string): void {
    this.reorder(this.indexOf(activeId), this.indexOf(overId));
  }

  // --- keyboard navigation -------------------------------------------------

  /** Ctrl+Tab — activate the next tab, wrapping to the first. */
  next(): void {
    const { tabs, activeEditorId } = this.state;
    if (tabs.length === 0) return;
    const idx = activeEditorId ? this.indexOf(activeEditorId) : -1;
    const nextIdx = (idx + 1 + tabs.length) % tabs.length;
    this.activate(tabs[nextIdx].editorId);
  }

  /** Ctrl+Shift+Tab — activate the previous tab, wrapping to the last. */
  prev(): void {
    const { tabs, activeEditorId } = this.state;
    if (tabs.length === 0) return;
    const idx = activeEditorId ? this.indexOf(activeEditorId) : tabs.length;
    const prevIdx = (idx - 1 + tabs.length) % tabs.length;
    this.activate(tabs[prevIdx].editorId);
  }

  /**
   * Ctrl+1..9 — jump to the 1-based tab number. UWP: 9 always means the LAST
   * tab; 1..8 map to those positions when present (no-op if out of range).
   */
  jumpTo(oneBased: number): void {
    const { tabs } = this.state;
    if (tabs.length === 0) return;
    if (oneBased === 9) {
      this.activate(tabs[tabs.length - 1].editorId);
      return;
    }
    const idx = oneBased - 1;
    if (idx < 0 || idx >= tabs.length) return;
    this.activate(tabs[idx].editorId);
  }

  // --- per-tab field mutations --------------------------------------------

  private patch(editorId: string, patch: Partial<TabState>): void {
    const idx = this.indexOf(editorId);
    if (idx === -1) return;
    const tabs = this.state.tabs.slice();
    tabs[idx] = { ...tabs[idx], ...patch };
    this.commit({ tabs, activeEditorId: this.state.activeEditorId });
  }

  setModified(editorId: string, isModified: boolean): void {
    if (this.get(editorId)?.isModified === isModified) return;
    this.patch(editorId, { isModified });
  }

  /** Rename: set a new absolute filePath (clears untitled display). */
  setFilePath(editorId: string, filePath: string | null): void {
    this.patch(editorId, { filePath });
  }

  /** Rename an untitled buffer's display name (UWP F2 on untitled). */
  setUntitledName(editorId: string, untitledName: string): void {
    this.patch(editorId, { untitledName });
  }

  /** Update opaque encoding/EOL labels (carried from MAIN; never derived). */
  setLabels(editorId: string, encodingId: EncodingId, eolId: EolId): void {
    this.patch(editorId, { encodingId, eolId });
  }

  setViewMode(editorId: string, viewMode: ViewMode): void {
    this.patch(editorId, { viewMode });
  }

  setCaret(editorId: string, start: number, end: number): void {
    this.patch(editorId, { caret: { start, end } });
  }

  setScroll(editorId: string, top: number, left: number): void {
    this.patch(editorId, { scroll: { top, left } });
  }
}

/** Process-wide singleton store (one window == one strip). */
export const tabsStore = new TabsStore();

/**
 * Set the base name used for future untitled buffers (Issue: localized new-file
 * name). The App calls this with the localized TextEditor_DefaultNewFileName stem
 * whenever the UI language resolves/changes, so the NEXT `newTab()` is named in
 * the active language. Existing tabs keep their names (UWP does not rename open
 * untitled docs on a language switch). A blank/whitespace value is ignored so a
 * missing resource never produces a nameless tab.
 */
export function setUntitledBaseName(base: string): void {
  const trimmed = base.trim();
  if (trimmed.length > 0) untitledBaseName = trimmed;
}

/**
 * React binding. Returns the live snapshot plus the bound action surface.
 * Components re-render only when the snapshot reference changes.
 */
export interface TabsApi extends TabsSnapshot {
  store: TabsStore;
}

export function useTabsStore(store: TabsStore = tabsStore): TabsApi {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(
    () => ({ tabs: snapshot.tabs, activeEditorId: snapshot.activeEditorId, store }),
    [snapshot, store],
  );
}
