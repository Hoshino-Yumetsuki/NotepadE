/**
 * Ambient globals for the E2E suite.
 *
 * - `window.notepads` binds to the AUTHORITATIVE contract type (src/shared).
 * - `window.__notepadsTest` is a PA-8-clean, renderer-only test seam exposed by
 *   App (lane-b). It contains NO Node built-ins — it only orchestrates the real
 *   `window.notepads` contract + the CM6 EditorView. Gated by NOTEPADS_E2E so it
 *   is absent in production builds. This lets the e2e suite drive the genuine
 *   open→CM6→save flow without monkey-patching the frozen contract.
 */

import type {
  NotepadsApi,
  Result,
  OpenedFile,
  SaveResult,
  EncodingId,
  EolId,
} from '../../src/shared/ipc-contract';

/**
 * Read-only snapshot of one tab, returned by the tab test seam. Mirrors the
 * renderer seam projection in src/renderer/tabs/tabsTestHook.ts (the source of
 * truth). Order in `tabs.list()` is the visual/logical tab order.
 */
export interface TabInfo {
  editorId: string;
  /** Display title (basename of filePath, else the untitled display name). */
  title: string;
  filePath: string | null;
  encodingId: EncodingId;
  eolId: EolId;
  isModified: boolean;
  active: boolean;
}

/**
 * Tab-strip test seam (Phase 2). PA-8-clean: composes only the in-renderer
 * TabsStore actions the UI itself calls. Read accessors (`list`, `activeId`,
 * `count`) are what the keyboard/matrix suites assert on; the mutators exercise
 * the genuine store path and are used to arrange preconditions only.
 *
 * MUST stay in sync with TabsTestHook in src/renderer/tabs/tabsTestHook.ts.
 */
export interface NotepadsTabsTestHook {
  list(): TabInfo[];
  activeId(): string | null;
  count(): number;
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

/**
 * Editor-surface test seam (Phase-3 gap harness). PA-8-clean: composes only the
 * live CM6 EditorView of the ACTIVE tab plus the public CM6 history helpers
 * (undoDepth/redoDepth). Read/arrange accessors the keyboard-conformance and
 * undo-granularity e2e suites assert on. Installed by App (lane-b) only under
 * NOTEPADS_E2E, so it is absent in production.
 *
 * MUST stay in sync with the editor seam in src/renderer/editor/test-hook.ts.
 */
export interface NotepadsEditorTestHook {
  /** Active view doc as the '\n'-normalized shadow buffer (exact). */
  getDocText(): string;
  /** Main selection [from, to) as document offsets. */
  getSelection(): { from: number; to: number };
  /** Set the main selection (arrange a precondition for a command). */
  setSelection(from: number, to: number): void;
  /** Focus the active editor surface. */
  focus(): void;
  /** Current zoom percent (zoomField), clamped 10..500, default 100. */
  getZoomPercent(): number;
  /** Whether word-wrap is on (wordWrapField). */
  isWordWrap(): boolean;
  /** Editor content direction ('ltr' | 'rtl'). */
  getDirection(): 'ltr' | 'rtl';
  /** CM6 history undo depth (number of undoable steps). */
  undoDepth(): number;
  /** CM6 history redo depth (number of redoable steps). */
  redoDepth(): number;
  /** Whether the .LOG once-per-open guard has fired (logEntryGuard). */
  isLogEntryGuardSet(): boolean;
  /**
   * The last query the Ctrl+E web-search command resolved (trimmed + capped), or
   * null if none ran since install. Lets the keyboard-conformance suite assert
   * the query WITHOUT monkey-patching the contextBridge-frozen
   * window.notepads.shell.webSearch. The real IPC call is unaffected.
   */
  lastWebSearchQuery(): string | null;
  /**
   * Insert `text` at the current selection in ONE transaction tagged as a paste
   * (userEvent 'input.paste'), so the undo-granularity suite can assert a paste
   * collapses to exactly one history step. Models a clipboard paste without the
   * OS clipboard.
   */
  insertAsPaste(text: string): void;
  /**
   * The query last passed to window.notepads.shell.webSearch by the Ctrl+E
   * command, or null. The frozen contract can't be spied from the test page, so
   * the renderer records it here under NOTEPADS_E2E.
   */
  lastWebSearchQuery(): string | null;
  /** Clear the recorded web-search query before exercising Ctrl+E. */
  resetWebSearch(): void;
}

export interface NotepadsTestHook {
  /** Calls window.notepads.file.open(path) then loads decodedText into CM6. */
  openFileIntoEditor(path: string): Promise<Result<OpenedFile>>;
  /** Returns the CM6 EditorView doc as a '\n'-normalized string (exact, not innerText). */
  getEditorDocText(): string;
  /** Reads the CM6 doc and calls window.notepads.file.save({filePath, shadowText, ...}). */
  saveEditorToPath(path: string): Promise<Result<SaveResult>>;
  /** Phase-2 tab-strip seam. Present once the tab store mounts (Lane C). */
  tabs?: NotepadsTabsTestHook;
  /** Phase-3 editor-surface seam. Present once the editor seam installs (lane-b). */
  editor?: NotepadsEditorTestHook;
}

declare global {
  interface Window {
    notepads: NotepadsApi;
    __notepadsTest: NotepadsTestHook;
  }
}

export {};
