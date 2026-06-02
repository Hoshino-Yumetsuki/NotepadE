import type { OpenedFile, Result, SaveResult } from '@shared/ipc-contract';
import type { CodeMirrorHandle } from './CodeMirrorEditor';

/**
 * Renderer test hook (RENDERER, Lane B) — exposes the REAL open/save flow to the
 * Gate-1 Playwright driver as `window.__notepadsTest`.
 *
 * This is PA-8 clean: it adds NO new IPC surface. Every method composes only the
 * public `window.notepads` contract plus the in-renderer CM6 handle. It exists
 * so the e2e exercises the genuine open→decode→IPC→CM6→save→encode→bytes path
 * (not the raw bridge), per e2e/roundtrip.e2e.ts.
 */
export interface NotepadsTestHook {
  /** Open `path` via window.notepads.file.open and load the decoded text into CM6. */
  openFileIntoEditor(path: string): Promise<Result<OpenedFile>>;
  /** The current '\n'-normalized CM6 shadow-buffer document. */
  getEditorDocText(): string;
  /** Save the current CM6 doc to `path` via window.notepads.file.save. */
  saveEditorToPath(path: string): Promise<Result<SaveResult>>;
}

/** Authoritative labels carried opaquely from MAIN; never re-derived. */
export interface OpenLabels {
  encodingId: string | null;
  eolId: 'crlf' | 'cr' | 'lf' | null;
}

/**
 * Install `window.__notepadsTest`. `getEditor` and `getLabels` are getters so the
 * hook always sees the live editor handle and the most recent open labels.
 * Returns an uninstall function.
 */
export function installTestHook(
  getEditor: () => CodeMirrorHandle | null,
  getLabels: () => OpenLabels,
  onOpened: (file: OpenedFile) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const hook: NotepadsTestHook = {
    async openFileIntoEditor(path: string): Promise<Result<OpenedFile>> {
      const result = await window.notepads.file.open(path);
      if (result.ok) onOpened(result.data);
      return result;
    },
    getEditorDocText(): string {
      return getEditor()?.getShadowText() ?? '';
    },
    async saveEditorToPath(path: string): Promise<Result<SaveResult>> {
      const labels = getLabels();
      const shadowText = getEditor()?.getShadowText() ?? '';
      return window.notepads.file.save({
        filePath: path,
        shadowText,
        ...(labels.encodingId ? { encodingId: labels.encodingId } : {}),
        ...(labels.eolId ? { eolId: labels.eolId } : {}),
      });
    },
  };

  window.__notepadsTest = hook;
  return () => {
    window.__notepadsTest = undefined;
  };
}

declare global {
  interface Window {
    /** Renderer test hook; present only when installTestHook has run. */
    __notepadsTest?: NotepadsTestHook;
  }
}
