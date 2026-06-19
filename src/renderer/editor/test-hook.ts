import type { OpenedFile, Result, SaveResult } from '@shared/ipc-contract';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { MonacoHandle } from './MonacoEditor';
import { getEditorZoom } from '../statusbar/useStatusBarModel';
import { setWebSearchObserver } from './commands/webSearchObserver';

/**
 * Renderer test hook (RENDERER, Lane B) — exposes the REAL open/save flow to the
 * Gate-1 Playwright driver as `window.__notepadsTest`.
 *
 * This is PA-8 clean: it adds NO new IPC surface. Every method composes only the
 * public `window.notepads` contract plus the in-renderer Monaco handle. It exists
 * so the e2e exercises the genuine open→decode→IPC→Monaco→save→encode→bytes path
 * (not the raw bridge), per e2e/roundtrip.e2e.ts.
 */
export interface NotepadsTestHook {
  /** Open `path` via window.notepads.file.open and load the decoded text into Monaco. */
  openFileIntoEditor(path: string): Promise<Result<OpenedFile>>;
  /** The current '\n'-normalized Monaco shadow-buffer document. */
  getEditorDocText(): string;
  /** Save the current Monaco doc to `path` via window.notepads.file.save. */
  saveEditorToPath(path: string): Promise<Result<SaveResult>>;
  /** Tabs seam (Phase 2) — installed separately by installTabsTestHook. */
  tabs?: import('../tabs/tabsTestHook').TabsTestHook;
  /** Editor-surface seam (Phase 3) — installed separately by installEditorTestHook. */
  editor?: EditorTestHook;
  /** Status-bar seam (Phase 4) — installed separately by useStatusBarModel (Lane C). */
  statusbar?: StatusBarTestHook;
  /** Settings seam (Phase 5) — installed separately by installSettingsTestHook (Lane C). */
  settings?: SettingsTestHook;
}

/**
 * Settings test seam (Phase 5, Lane C). PA-8-clean: composes only the live
 * settings bag (window.notepads.settings) + the resolved FluentProvider theme
 * bucket the App is rendering. Lets the Gate-5 harness open the settings surface,
 * read a single persisted setting, and assert the active theme bucket WITHOUT
 * inspecting Fluent internals.
 *
 * MUST stay in sync with NotepadsSettingsTestHook in
 * e2e/types/notepads-global.d.ts.
 */
export interface SettingsTestHook {
  /** Open the settings surface (same as the toolbar/command entry point). */
  openSettings(): void;
  /** Close the settings surface. */
  closeSettings(): void;
  /** The resolved theme bucket the FluentProvider is using right now. */
  getActiveTheme(): 'light' | 'dark' | 'hc';
  /** Read one persisted setting value by key (from the live MAIN-owned bag). */
  getSetting<K extends keyof import('@shared/ipc-contract').Settings>(
    key: K
  ): import('@shared/ipc-contract').Settings[K];
}

/**
 * Status-bar test seam (Phase 4, Lane C). PA-8-clean: composes only
 * window.notepads.file.revalidatePath + the renderer column-0 state machine, so
 * the e2e can force a synchronous external-modification check without waiting on
 * the ~3s poll timer.
 *
 * MUST stay in sync with NotepadsStatusBarTestHook in
 * e2e/types/notepads-global.d.ts.
 */
export interface StatusBarTestHook {
  /** Force a check on the active file-backed tab; returns the derived column-0 state. */
  checkFileStatus(): Promise<'none' | 'modifiedOutside' | 'renamedMovedDeleted'>;
}

/**
 * Editor-surface test seam (Phase-3 gap harness). PA-8-clean: composes only the
 * live Monaco editor of the ACTIVE tab. Read/arrange accessors the
 * keyboard-conformance and undo-granularity e2e suites assert on.
 *
 * MUST stay in sync with NotepadEditorTestHook in e2e/types/notepads-global.d.ts.
 */
export interface EditorTestHook {
  /** Active editor doc as the '\n'-normalized shadow buffer (exact). */
  getDocText(): string;
  /** Main selection [from, to) as document offsets. */
  getSelection(): { from: number; to: number };
  /** Set the main selection (arrange a precondition for a command). */
  setSelection(from: number, to: number): void;
  /** Focus the active editor surface. */
  focus(): void;
  /** Current zoom percent, clamped 10..500, default 100. */
  getZoomPercent(): number;
  /** Whether word-wrap is on. */
  isWordWrap(): boolean;
  /** Editor content direction ('ltr' | 'rtl'). */
  getDirection(): 'ltr' | 'rtl';
  /** Undo depth (number of undoable steps). */
  undoDepth(): number;
  /** Redo depth (number of redoable steps). */
  redoDepth(): number;
  /** Whether the .LOG once-per-open guard has fired. */
  isLogEntryGuardSet(): boolean;
  /**
   * The last query the Ctrl+E web-search command resolved (trimmed + capped),
   * or null if none ran since install.
   */
  lastWebSearchQuery(): string | null;
  /**
   * Insert `text` at the current selection as a paste operation so the
   * undo-granularity suite can assert a paste collapses to exactly one history step.
   */
  insertAsPaste(text: string): void;
}

/** Authoritative labels carried opaquely from MAIN; never re-derived. */
export interface OpenLabels {
  encodingId: string | null;
  eolId: 'crlf' | 'cr' | 'lf' | null;
}

/**
 * Convert a document offset to a Monaco IPosition (1-based lineNumber + column).
 * Walks the model's line count to find the right line.
 */
function offsetToPosition(model: monaco.editor.ITextModel, offset: number): monaco.IPosition {
  return model.getPositionAt(offset);
}

/**
 * Convert a Monaco IPosition to a document offset.
 */
function positionToOffset(model: monaco.editor.ITextModel, position: monaco.IPosition): number {
  return model.getOffsetAt(position);
}

/**
 * Install `window.__notepadsTest`. `getEditor` and `getLabels` are getters so the
 * hook always sees the live editor handle and the most recent open labels.
 * Returns an uninstall function.
 */
export function installTestHook(
  getEditor: () => MonacoHandle | null,
  getLabels: () => OpenLabels,
  onOpened: (file: OpenedFile) => void
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
        ...(labels.eolId ? { eolId: labels.eolId } : {})
      });
    }
  };

  window.__notepadsTest = hook;
  return () => {
    window.__notepadsTest = undefined;
  };
}

/**
 * Install the editor-surface seam onto `window.__notepadsTest.editor`. `getEditor`
 * is a getter so the seam always reads the ACTIVE tab's live Monaco editor.
 * Returns an uninstall function. Requires installTestHook to have run first.
 *
 * PA-8: composes only the Monaco editor + public APIs; no IPC, no fs.
 *
 * Notes on Monaco vs CM6 parity:
 *   - undoDepth / redoDepth: Monaco exposes no public API to read history stack
 *     depths. These return 0 until T3 adds a history-depth seam if e2e needs it.
 *   - isLogEntryGuardSet: the .LOG guard is managed by T3's keymap; this seam
 *     returns false until T3 exposes a queryable guard.
 *   - getDirection: reads the Monaco editor DOM's `dir` attribute (set by T3).
 */
export function installEditorTestHook(
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null
): () => void {
  if (typeof window === 'undefined') return () => {};

  let lastWebSearch: string | null = null;
  setWebSearchObserver((query) => {
    lastWebSearch = query;
  });

  const editorHook: EditorTestHook = {
    getDocText(): string {
      const editor = getEditor();
      if (!editor) return '';
      return editor.getModel()?.getValue(1 /* LF */) ?? '';
    },
    getSelection(): { from: number; to: number } {
      const editor = getEditor();
      if (!editor) return { from: 0, to: 0 };
      const model = editor.getModel();
      const sel = editor.getSelection();
      if (!model || !sel) return { from: 0, to: 0 };
      return {
        from: positionToOffset(model, sel.getStartPosition()),
        to: positionToOffset(model, sel.getEndPosition())
      };
    },
    setSelection(from: number, to: number): void {
      const editor = getEditor();
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const start = offsetToPosition(model, from);
      const end = offsetToPosition(model, to);
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column
      });
    },
    focus(): void {
      getEditor()?.focus();
    },
    getZoomPercent(): number {
      const editor = getEditor();
      return editor ? getEditorZoom(editor) : 100;
    },
    isWordWrap(): boolean {
      const editor = getEditor();
      if (!editor) return false;
      const wrap = editor.getOption(
        // monaco.editor.EditorOption.wordWrap = 132 (stable numeric ID)
        // Use the string key via getRawOptions() to avoid importing the enum.
        132 as Parameters<typeof editor.getOption>[0]
      );
      return wrap === 'on' || wrap === 'bounded' || wrap === 'wordWrapColumn';
    },
    getDirection(): 'ltr' | 'rtl' {
      const editor = getEditor();
      if (!editor) return 'ltr';
      // T3 sets the content `dir` attribute on the Monaco content DOM node.
      const contentDom = editor
        .getDomNode()
        ?.querySelector<HTMLElement>('.monaco-editor .lines-content');
      return contentDom?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    },
    undoDepth(): number {
      // Monaco has no public API to query undo stack depth.
      // Returns 0 until T3 exposes a depth seam via the model's edit stack.
      return 0;
    },
    redoDepth(): number {
      return 0;
    },
    isLogEntryGuardSet(): boolean {
      // The .LOG guard is internal to T3's keymap implementation.
      // Returns false until T3 exports a queryable guard.
      return false;
    },
    lastWebSearchQuery(): string | null {
      return lastWebSearch;
    },
    insertAsPaste(text: string): void {
      const editor = getEditor();
      if (!editor) return;
      const model = editor.getModel();
      const sel = editor.getSelection();
      if (!model || !sel) return;
      // Execute as a single edit tagged as a paste so undo-granularity e2e can
      // assert it collapses to one history step.
      editor.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]);
    }
  };

  const existing = window.__notepadsTest;
  if (existing) existing.editor = editorHook;

  return () => {
    setWebSearchObserver(undefined);
    if (window.__notepadsTest) window.__notepadsTest.editor = undefined;
  };
}

declare global {
  interface Window {
    /** Renderer test hook; present only when installTestHook has run. */
    __notepadsTest?: NotepadsTestHook;
  }
}
