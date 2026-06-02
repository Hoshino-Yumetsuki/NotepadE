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

export interface NotepadsTestHook {
  /** Calls window.notepads.file.open(path) then loads decodedText into CM6. */
  openFileIntoEditor(path: string): Promise<Result<OpenedFile>>;
  /** Returns the CM6 EditorView doc as a '\n'-normalized string (exact, not innerText). */
  getEditorDocText(): string;
  /** Reads the CM6 doc and calls window.notepads.file.save({filePath, shadowText, ...}). */
  saveEditorToPath(path: string): Promise<Result<SaveResult>>;
  /** Phase-2 tab-strip seam. Present once the tab store mounts (Lane C). */
  tabs?: NotepadsTabsTestHook;
}

declare global {
  interface Window {
    notepads: NotepadsApi;
    __notepadsTest: NotepadsTestHook;
  }
}

export {};
