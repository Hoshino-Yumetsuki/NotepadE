import type { OpenedFile, Result, SaveResult } from '@shared/ipc-contract';
import type { EditorView } from '@codemirror/view';
import { undoDepth as cmUndoDepth, redoDepth as cmRedoDepth } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import type { CodeMirrorHandle } from './CodeMirrorEditor';
import { zoomField, DEFAULT_ZOOM } from './commands/zoom';
import { wordWrapField } from './commands/wordWrap';
import { logEntryGuard } from './commands/datetime';
import { setWebSearchObserver } from './commands/webSearch';

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
    key: K,
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
 * live CM6 EditorView of the ACTIVE tab plus the public CM6 history helpers
 * (undoDepth/redoDepth). Read/arrange accessors the keyboard-conformance and
 * undo-granularity e2e suites assert on.
 *
 * MUST stay in sync with NotepadEditorTestHook in e2e/types/notepads-global.d.ts.
 */
export interface EditorTestHook {
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
   * The last query the Ctrl+E web-search command resolved (trimmed + capped),
   * or null if none ran since install. Lets the e2e assert the query WITHOUT
   * monkey-patching the contextBridge-frozen window.notepads.shell.webSearch.
   * The real IPC call is unaffected — this only records what was sent.
   */
  lastWebSearchQuery(): string | null;
  /**
   * Insert `text` at the current selection in ONE transaction tagged as a paste
   * (userEvent 'input.paste'), so the undo-granularity suite can assert a paste
   * collapses to exactly one history step.
   */
  insertAsPaste(text: string): void;
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

/**
 * Install the editor-surface seam onto `window.__notepadsTest.editor`. `getView`
 * is a getter so the seam always reads the ACTIVE tab's live CM6 view. Returns
 * an uninstall function. Requires installTestHook to have run first (it attaches
 * to the same `window.__notepadsTest` object).
 *
 * PA-8: composes only the EditorView + public CM6 history helpers; no IPC, no fs.
 */
export function installEditorTestHook(getView: () => EditorView | null): () => void {
  if (typeof window === 'undefined') return () => {};

  // Records the last Ctrl+E query the web-search command resolved (renderer-only;
  // observes, never alters the real IPC call).
  let lastWebSearch: string | null = null;
  setWebSearchObserver((query) => {
    lastWebSearch = query;
  });

  const editor: EditorTestHook = {
    getDocText(): string {
      return getView()?.state.doc.toString() ?? '';
    },
    getSelection(): { from: number; to: number } {
      const view = getView();
      if (!view) return { from: 0, to: 0 };
      const { from, to } = view.state.selection.main;
      return { from, to };
    },
    setSelection(from: number, to: number): void {
      const view = getView();
      if (!view) return;
      view.dispatch({ selection: EditorSelection.range(from, to) });
    },
    focus(): void {
      getView()?.focus();
    },
    getZoomPercent(): number {
      const view = getView();
      return view ? (view.state.field(zoomField, false) ?? DEFAULT_ZOOM) : DEFAULT_ZOOM;
    },
    isWordWrap(): boolean {
      const view = getView();
      return view ? (view.state.field(wordWrapField, false) ?? false) : false;
    },
    getDirection(): 'ltr' | 'rtl' {
      const view = getView();
      if (!view) return 'ltr';
      // CM6 derives textDirection from the content `dir` attribute the direction
      // command sets via contentAttributes; read it back directly.
      return view.contentDOM.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    },
    undoDepth(): number {
      const view = getView();
      return view ? cmUndoDepth(view.state) : 0;
    },
    redoDepth(): number {
      const view = getView();
      return view ? cmRedoDepth(view.state) : 0;
    },
    isLogEntryGuardSet(): boolean {
      const view = getView();
      return view ? (view.state.field(logEntryGuard, false) ?? false) : false;
    },
    lastWebSearchQuery(): string | null {
      return lastWebSearch;
    },
    insertAsPaste(text: string): void {
      const view = getView();
      if (!view) return;
      view.dispatch(
        view.state.update(view.state.replaceSelection(text), { userEvent: 'input.paste' }),
      );
    },
  };

  const existing = window.__notepadsTest;
  if (existing) existing.editor = editor;

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
