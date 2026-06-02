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

import type { NotepadsApi, Result, OpenedFile, SaveResult } from '../../src/shared/ipc-contract';

export interface NotepadsTestHook {
  /** Calls window.notepads.file.open(path) then loads decodedText into CM6. */
  openFileIntoEditor(path: string): Promise<Result<OpenedFile>>;
  /** Returns the CM6 EditorView doc as a '\n'-normalized string (exact, not innerText). */
  getEditorDocText(): string;
  /** Reads the CM6 doc and calls window.notepads.file.save({filePath, shadowText, ...}). */
  saveEditorToPath(path: string): Promise<Result<SaveResult>>;
}

declare global {
  interface Window {
    notepads: NotepadsApi;
    __notepadsTest: NotepadsTestHook;
  }
}

export {};
