import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
// Side-effect import: installs self.MonacoEnvironment (Vite `?worker` wiring)
// before the first monaco.editor.create runs. Must precede any editor creation.
import './monacoEnvironment';
import './monaco-acrylic.css';
import type { EditorSettings } from './editorSettings';
import { parseHexColor } from './colorUtils';
import { DEFAULT_FONT_FAMILY, resolveFontFamily } from './fontFamily';

/** Text flow direction. Ctrl+L/R flip the editor DOM `dir` live (see monacoCommands). */
export type TextDirection = 'ltr' | 'rtl';
import { wireCommands, tryInsertLogEntry as runLogEntry } from './monacoCommands';
import { registerFindKeybindings, type FindKeymapCallbacks } from './search/findKeymap';
import { initEditorZoom, setEditorZoomBase } from './zoomRegistry';
import { attachLineNumberGlow } from './lineNumberGlow';
import { attachCurrentLineEdge } from './currentLineEdge';

// The find-keymap + context-menu helpers (T4) read `globalThis.monaco` for KeyMod
// /KeyCode/EditorOption, because they import the ESM API only as a TYPE. Our deep
// `editor.api` import does NOT auto-assign that global, so publish it once here
// (idempotent) before any editor is created. Plain-text build: this is just the
// editor API surface, no languages/workers beyond the core editor worker.
(globalThis as unknown as { monaco?: typeof monaco }).monaco ??= monaco;

/**
 * Imperative handle the host (App) uses to drive the editor without owning the
 * Monaco instance. API-compatible with the legacy CodeMirrorHandle so the host's
 * editorHandles map, save pipeline and find/status seams can drive either editor:
 *   - `setDoc` / `getShadowText` / `focus` / `tryInsertLogEntry` are identical.
 *   - `getEditor()` replaces `getView()` (returns the Monaco editor, not a CM6
 *     EditorView).
 */
export interface MonacoHandle {
  /** Replace the entire document with `text`, normalized to the '\n' shadow buffer. */
  setDoc(text: string): void;
  /** Append a decoded chunk without adding it to the undo stack or dirty state. */
  appendText?(text: string): void;
  /** Change read-only state after an initial streamed load completes. */
  setReadOnly?(readOnly: boolean): void;
  /** Enable heap/sync guards after Monaco has finished creating the live view. */
  setLargeFileGuards?(): void;
  /** Current document as a '\n'-normalized shadow-buffer string (for save). */
  getShadowText(): string;
  getSnapshot?: () => monaco.editor.ITextSnapshot | null;
  /** Focus the editor surface. */
  focus(): void;
  /** Attempt the `.LOG` once-per-open auto-timestamp. */
  tryInsertLogEntry(): boolean;
  /** The live Monaco editor, or null before mount / after unmount. */
  getEditor(): monaco.editor.IStandaloneCodeEditor | null;
}

export interface MonacoEditorProps {
  /** Initial document (will be '\n'-normalized). Defaults to empty. */
  initialDoc?: string;
  /** Whether to render the gutter line numbers. */
  lineNumbers?: boolean;
  /** Host-provided editor-behavior settings (opaque for T1; consumed in T3). */
  settings?: Partial<EditorSettings>;
  /** Initial text direction. Defaults to 'ltr'. */
  direction?: TextDirection;
  /** Initial word-wrap state. Defaults to false (NoWrap). */
  wordWrap?: boolean;
  /** Whether the current-line highlight is shown. Defaults to true. */
  lineHighlighter?: boolean;
  /** Resolved app-theme bucket — picks the Monaco theme + acrylic tints. */
  themeMode?: 'light' | 'dark' | 'hc';
  /** Editor typography (sourced 1:1 from persisted Settings). */
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontWeight?: number;
  /** Selection-highlight color (resolved app accent, #RRGGBB). */
  accentColor?: string;
  /** Enable Monaco's permanent large-file guards for a progressively-filled model. */
  largeFileOptimizations?: boolean;
  /** Called after the editor/model mount has completed. */
  onReady?: (handle: MonacoHandle) => void;
  /** Fired whenever the document content changes (Monaco onDidChangeModelContent). */
  onDocChanged?: () => void;
  /** Whether the editor starts read-only, used during large-file streaming. */
  readOnly?: boolean;
  /** Find-bar keybinding callbacks. */
  findCallbacks?: FindKeymapCallbacks;
  /** Attach the host-owned right-click context menu. */
  contextMenuAttach?: (editor: monaco.editor.IStandaloneCodeEditor) => monaco.IDisposable;
}

/** UWP RichEditBox defaults (Segoe UI / 14 / normal-400) — used when no setting. */
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_ACCENT = '#0078D4';

/** Monaco theme names defined once below (defineTheme is idempotent per name). */
const THEME_NAMES: Record<'light' | 'dark' | 'hc', string> = {
  light: 'notepade-light',
  dark: 'notepade-dark',
  hc: 'notepade-hc'
};

/**
 * Selection background as an `#RRGGBBAA` Monaco color token built from the accent
 * using the same alpha in light and dark modes (HC keeps the opaque accent —
 * forced-colors repaints selection anyway).
 * Monaco expects a hex string in theme `colors`, so we emit `#RRGGBBAA`.
 */
function selectionColor(themeMode: 'light' | 'dark' | 'hc', accentColor: string): string {
  const rgb = parseHexColor(accentColor);
  if (!rgb || themeMode === 'hc') return accentColor;
  const alpha = 0.28;
  const aa = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}${aa}`;
}

/**
 * Define the three NotepadE themes. Each is TRANSPARENT
 * (`editor.background:#00000000`, `editorGutter.background:#00000000`) so the OS
 * acrylic shows through, with a subtle current-line wash matching the CM6 values
 * (dark #ffffff0d ≈ rgba(255,255,255,0.05) / light #7f7f7f14 ≈
 * rgba(127,127,127,0.08)) and the accent-derived selection. HC inherits the
 * built-in hc-black (forced flat system colors) but still pins a transparent
 * editor background so the window chrome stays consistent.
 *
 * Re-running defineTheme for an already-defined name just updates it (so calling
 * this on accent change rebuilds the selection color live).
 */
function defineThemes(themeMode: 'light' | 'dark' | 'hc', accentColor: string): void {
  const selection = selectionColor(themeMode, accentColor);
  monaco.editor.defineTheme(THEME_NAMES.light, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000',
      'editor.lineHighlightBackground': '#7f7f7f14',
      'editor.lineHighlightBorder': '#00000000',
      // Electron/CM6 muted line numbers (0.6α rest / 0.95α active). Monaco's
      // default light line number is teal (#237893), which read as a different
      // color from the editor body — restore the neutral gray.
      'editorLineNumber.foreground': '#00000099',
      'editorLineNumber.activeForeground': '#000000f2',
      // Neutralize the IDE highlight tokens so nothing tints the surface even if
      // a feature re-enables (bracket-match green, occurrence/selection boxes).
      'editorBracketMatch.background': '#00000000',
      'editorBracketMatch.border': '#00000000',
      'editor.selectionHighlightBackground': '#00000000',
      'editor.selectionHighlightBorder': '#00000000',
      'editor.wordHighlightBackground': '#00000000',
      'editor.wordHighlightStrongBackground': '#00000000',
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': selection
    }
  });
  monaco.editor.defineTheme(THEME_NAMES.dark, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000',
      'editor.lineHighlightBackground': '#ffffff0d',
      'editor.lineHighlightBorder': '#00000000',
      // Electron/CM6 muted line numbers (0.6α rest / 0.95α active).
      'editorLineNumber.foreground': '#eeeeee99',
      'editorLineNumber.activeForeground': '#eeeeeef2',
      'editorBracketMatch.background': '#00000000',
      'editorBracketMatch.border': '#00000000',
      'editor.selectionHighlightBackground': '#00000000',
      'editor.selectionHighlightBorder': '#00000000',
      'editor.wordHighlightBackground': '#00000000',
      'editor.wordHighlightStrongBackground': '#00000000',
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': selection
    }
  });
  monaco.editor.defineTheme(THEME_NAMES.hc, {
    base: 'hc-black',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#00000000',
      'editorGutter.background': '#00000000'
    }
  });
}

/**
 * Monaco editor mount (RENDERER, Lane B) as a PLAIN TEXT editor. One
 * IStandaloneCodeEditor over one model whose EOL is pinned to LF (the shadow
 * buffer). API-compatible imperative handle so the host drives it like the CM6
 * editor did.
 *
 * The acrylic "材质" fix is central: the themes paint a transparent editor +
 * gutter background, monaco-acrylic.css forces the remaining opaque Monaco layers
 * transparent, and a non-promoted gutter material strip (reproducing CM commit
 * 7b18f6b) is injected on `.monaco-editor` so the gutter reads as its own faintly
 * darker acrylic panel without blocking the OS material.
 */
export const MonacoEditor = forwardRef<MonacoHandle, MonacoEditorProps>(function MonacoEditor(
  {
    initialDoc = '',
    lineNumbers: showLineNumbers = false,
    readOnly = false,
    // `settings` feeds the command wiring (tabAsSpaces / smartCopy / base
    // fontSize) via settingsRef; `direction` is the initial flow direction
    // (the Ctrl+L/R commands flip it live on the editor DOM).
    settings,
    direction = 'ltr',
    wordWrap = false,
    largeFileOptimizations = false,
    lineHighlighter = true,
    themeMode = 'light',
    fontFamily: fontFamilyRaw = DEFAULT_FONT_FAMILY,
    fontSize = DEFAULT_FONT_SIZE,
    fontStyle = 'normal',
    fontWeight = 400,
    accentColor = DEFAULT_ACCENT,
    onDocChanged,
    findCallbacks,
    contextMenuAttach,
    onReady
  },
  ref
) {
  const fontFamily = resolveFontFamily(fontFamilyRaw);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  // Latest onDocChanged, read by the mount-once content listener (a ref keeps the
  // listener stable so a changing callback identity never tears down the editor).
  const onDocChangedRef = useRef<(() => void) | undefined>(onDocChanged);
  onDocChangedRef.current = onDocChanged;
  // Find callbacks + context-menu attach are read once at mount (registrations
  // are editor-lifetime). Refs keep the mount-once effect stable.
  const findCallbacksRef = useRef<FindKeymapCallbacks | undefined>(findCallbacks);
  findCallbacksRef.current = findCallbacks;
  const contextMenuAttachRef = useRef(contextMenuAttach);
  contextMenuAttachRef.current = contextMenuAttach;
  const onReadyRef = useRef<((handle: MonacoHandle) => void) | undefined>(onReady);
  onReadyRef.current = onReady;
  // Host-authoritative document parked here ONLY while no editor exists. Once a
  // live model holds the doc this is cleared; re-captured on unmount so a remount
  // (React StrictMode double-mount, tab key change) restores it. Mirrors the CM6
  // docRef contract — Monaco's model survives detaching, so we re-park the string.
  const docRef = useRef<string | null>(null);
  // Live editor-behavior settings, read by the command wiring (tabAsSpaces /
  // smartCopy / base fontSize). A ref keeps the mount-once command handlers
  // reading the CURRENT value without re-registering on every settings change.
  const settingsRef = useRef<Partial<EditorSettings> | undefined>(settings);
  const suppressDocChangedRef = useRef(false);
  settingsRef.current = settings;
  // Per-tab `.LOG` once-per-open guard (mirrors UWP's `_hasAddedLogEntry`). An
  // authoritative setDoc (open / activate / adopt / reload) resets it so a freshly
  // opened `.LOG` file can re-stamp exactly once.
  const logGuardRef = useRef<{ added: boolean }>({ added: false });
  const imperativeHandleRef = useRef<MonacoHandle | null>(null);

  useImperativeHandle(
    ref,
    (): MonacoHandle => {
      const handle: MonacoHandle = {
        setDoc(text: string): void {
          const model = modelRef.current;
          if (!model) {
            docRef.current = text;
            logGuardRef.current.added = false;
            return;
          }
          docRef.current = null;
          logGuardRef.current.added = false;
          model.pushEditOperations(null, [{ range: model.getFullModelRange(), text }], () => null);
        },
        appendText(text: string): void {
          const model = modelRef.current ?? editorRef.current?.getModel() ?? null;
          if (!model || text.length === 0) return;
          const end = model.getFullModelRange().getEndPosition();
          suppressDocChangedRef.current = true;
          try {
            model.applyEdits(
              [{ range: new monaco.Range(end.lineNumber, end.column, end.lineNumber, end.column), text }],
              false
            );
          } finally {
            suppressDocChangedRef.current = false;
          }
        },
        setReadOnly(readOnly: boolean): void {
          editorRef.current?.updateOptions({ readOnly });
        },
        setLargeFileGuards(): void {
          const model = modelRef.current ?? editorRef.current?.getModel() ?? null;
          if (!model) return;
          const largeModel = model as unknown as {
            _isTooLargeForHeapOperation: boolean;
            _isTooLargeForSyncing: boolean;
            _npLargeFileReady: boolean;
          };
          const length = model.getValueLength(monaco.editor.EndOfLinePreference.LF);
          // Match VS Code's policy: disable worker syncing above 50 MiB and
          // heap-amplifying operations above 256M characters. The progressive
          // model remains searchable/editable below those limits.
          largeModel._isTooLargeForHeapOperation = length > 256 * 1024 * 1024;
          largeModel._isTooLargeForSyncing = length > 50 * 1024 * 1024;
          largeModel._npLargeFileReady = true;
        },
        getShadowText(): string {
          const model = modelRef.current;
          return model ? model.getValue(monaco.editor.EndOfLinePreference.LF) : '';
        },
        getSnapshot(): monaco.editor.ITextSnapshot | null {
          return modelRef.current?.createSnapshot() ?? null;
        },
        focus(): void {
          editorRef.current?.focus();
        },
        tryInsertLogEntry(): boolean {
          const editor = editorRef.current;
          if (!editor) return false;
          return runLogEntry(editor, {
            getSettings: () => settingsRef.current ?? {},
            logGuard: logGuardRef.current
          });
        },
        getEditor(): monaco.editor.IStandaloneCodeEditor | null {
          return editorRef.current;
        }
      };
      imperativeHandleRef.current = handle;
      return handle;
    },
    []
  );
  useEffect(() => {
    if (!hostRef.current) return;

    defineThemes(themeMode, accentColor);
    const model = monaco.editor.createModel(docRef.current ?? initialDoc, undefined);
    modelRef.current = model;
    if (largeFileOptimizations) {
      // Monaco decides tokenization permanently from the constructor's initial
      // buffer size. Progressive loading starts empty, so set this guard before
      // the model is attached to the editor and keep readiness false until EOF.
      const largeModel = model as unknown as {
        _isTooLargeForTokenization: boolean;
        _npLargeFileReady: boolean;
      };
      largeModel._isTooLargeForTokenization = true;
      largeModel._npLargeFileReady = false;
    }
    model.setEOL(monaco.editor.EndOfLineSequence.LF);

    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme: THEME_NAMES[themeMode],
      readOnly,
      // Layout is driven MANUALLY by the visibility-aware ResizeObserver below
      // (not Monaco's built-in automaticLayout). With one editor mounted PER TAB
      // and inactive tabs hidden via `display:none` (App renders all tabs, only
      // the active one is shown), automaticLayout:true makes EVERY hidden editor
      // keep a live ResizeObserver and forces a synchronous full re-measure +
      // repaint the instant a tab toggles display:none→block. For a multi-MB file
      // that show-relayout — multiplied across several open large tabs and the GC
      // pressure of N live models — stalls the main thread long enough that
      // WebView2 kills the renderer on tab switch. Our observer skips layout while
      // the host is hidden (0×0) and lays out exactly once when it becomes visible.
      automaticLayout: false,
      // Plain-text editor: strip the IDE chrome.
      minimap: { enabled: false },
      lineNumbers: showLineNumbers ? 'on' : 'off',
      // Trim the native gutter to the original tight column: a plain-text editor
      // has no glyphs/folding/decorations, and the 5-digit default min reserves
      // dead space. This makes Monaco's gutter read like the pre-migration column.
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 10,
      // Hug the actual digit count (minChars:1) — no reserved empty slots that a
      // growing number must "fill" before the column widens. The column grows
      // exactly when a digit is added (10, 100, 1000). Left breathing room is
      // supplied as a CONSTANT gutter inset on the host wrapper (see the return
      // below), NOT extra digit slots, so there is no fill-before-widen lag.
      lineNumbersMinChars: 1,
      // Monaco's padding option only supports top/bottom (there is NO left). The
      // left gutter inset is a CSS padding-left on `.monaco-editor` (see the host
      // wrapper / monaco-acrylic.css); it lives OUTSIDE Monaco's clipped paint
      // region, so renderLineHighlight:'all' can't fill it — attachCurrentLineEdge
      // paints the current-line band into that left gap manually.
      padding: { top: 0, bottom: 0 },
      wordWrap: wordWrap ? 'on' : 'off',
      // The current-line band is drawn MANUALLY (attachCurrentLineEdge), not by
      // Monaco. Monaco's native band is clipped to `.overflow-guard`, which starts
      // after the CSS padding-left inset — so it can't reach the window's left
      // edge, and pairing it with a filler strip leaves a visible seam. We paint
      // one continuous full-width band ourselves instead; keep native 'none' so
      // the two never double-composite.
      renderLineHighlight: 'none',
      // Plain-text Notepad has no IDE affordances. These default ON in Monaco and
      // paint over our acrylic surface: bracket matching draws a GREEN box on the
      // current line near brackets; selection/occurrence highlight draws BLUE
      // bordered boxes around matching text. CM6 had none of these — disable them.
      matchBrackets: 'never',
      selectionHighlight: false,
      occurrencesHighlight: 'off',
      // Newline + indentation is owned ENTIRELY by Monaco's native Enter (a single
      // EditContext input path). 'full' preserves the current line's leading
      // whitespace on Enter for plain text — the same effect the old custom
      // runAutoIndent produced, but without a competing executeEdits that left the
      // caret a line behind and a trailing blank line at EOF (keydown.preventDefault
      // cannot cancel an EditContext text insertion, so the custom path could never
      // win — it only double-edited).
      autoIndent: 'full',
      fontFamily,
      fontSize,
      fontWeight: String(fontWeight),
      // Monaco has no fontStyle option; italic/oblique is applied via CSS on the
      // host below (the .monaco-editor inherits it). Kept out of options here.
      scrollBeyondLastLine: false,
      // Thin caret. The browser's native EditContext caret is hidden via CSS
      // (monaco-acrylic.css), leaving Monaco's synthetic cursor; pin it to a 1px
      // line so it matches the original thin caret, not Monaco's ~2px default.
      cursorStyle: 'line',
      cursorWidth: 1,
      // Kill the black cursor-position tick and the ruler border in the scroll
      // gutter; slim the scrollbar to match the app's thin chrome scrollbar.
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: {
        verticalScrollbarSize: 6,
        horizontalScrollbarSize: 6,
        useShadows: false,
        vertical: 'visible',
        horizontal: 'auto'
      },
      // Plain-text editor: no IDE affordances. Monaco's built-in find widget
      // (Ctrl+F) is left enabled for now — T4 ports the custom FindBar and at
      // that point Monaco's Ctrl+F binding is removed so the two don't conflict.
      contextmenu: false,
      roundedSelection: false
    });
    editorRef.current = editor;
    // Seed the shared zoom registry at 100% on the host-provided base font size,
    // so keyboard/wheel zoom and the status-bar slider share one source of truth.
    initEditorZoom(editor, fontSize);
    // The model owns the doc now; drop the parked string so a large file is
    // retained once (in the model), not twice (mirrors the CM6 docRef contract).
    docRef.current = null;

    // fontStyle (italic/oblique) — Monaco has no option for it; apply via CSS.
    if (fontStyle !== 'normal') {
      editor.getDomNode()?.style.setProperty('font-style', fontStyle);
    }

    // Initial text flow direction (Ctrl+L/R flip it live afterwards).
    if (direction === 'rtl') {
      editor.getDomNode()?.setAttribute('dir', 'rtl');
    }

    // Wire every editor command + keybinding (reuses the T2 pure cores). The
    // command handlers read live settings via settingsRef, so they pick up
    // tabAsSpaces / smartCopy / fontSize changes without re-registering.
    const disposeCommands = wireCommands(editor, {
      getSettings: () => settingsRef.current ?? {},
      logGuard: logGuardRef.current
    });

    // Find-bar keybindings (Ctrl+F/H/G, F3/Shift+F3, Esc) — overrides Monaco's
    // built-in find widget so the custom acrylic FindBar owns those chords (T4).
    const findCb = findCallbacksRef.current;
    const findKeysSub = findCb ? registerFindKeybindings(editor, findCb) : null;

    // Right-click context menu (Cut/Copy/Paste/Undo/Redo/Select All/RTL/Word Wrap/
    // Search/Preview/Share) — the host owns the Fluent menu; we attach the listener.
    const ctxMenuSub = contextMenuAttachRef.current?.(editor) ?? null;

    // Dirty-tracking seam: fire onDocChanged on any model content change.
    const contentSub = model.onDidChangeContent(() => {
      if (!suppressDocChangedRef.current) onDocChangedRef.current?.();
    });
    // The editor root paints a left-edge gradient: a translucent wash over the
    // gutter region, transparent beyond (see monaco-acrylic.css). The root is not
    // GPU-promoted, so the wash composites WITH vibrancy (acrylic shows through),
    // unlike a background on the promoted `.margin` (which renders solid gray). We
    // set the wash color and gutter width (contentLeft, the x where text begins) as CSS
    // custom properties, syncing width on layout change.
    const rootNode = editor.getDomNode();
    // The gutter inset (CSS padding-left on .monaco-editor) that lets the
    // current-line highlight band reach the window's LEFT edge. Because
    // .monaco-editor is content-box with overflow:visible and its .overflow-guard
    // is position:relative (normal flow), this padding shifts Monaco's whole view
    // 12px right. The vertical scrollbar is anchored to the RIGHT edge of that
    // view, so unless we shrink the laid-out width by the same amount, the bar
    // lands ~12px past the window's right edge and is never visible. The manual
    // layout below subtracts GUTTER_INSET_PX so padding(12) + content(width-12)
    // == host width exactly, keeping the vertical scrollbar on-screen.
    const GUTTER_INSET_PX = 12;
    rootNode?.style.setProperty('--np-gutter-wash', 'transparent');
    // --np-gutter-inset is the CSS padding-left on .monaco-editor (12px). Monaco's
    // layout coordinates are relative to its own content box (i.e. after padding),
    // so the gradient stop must be offset by the same inset amount to land at the
    // true gutter↔content boundary in the element's padding-box coordinate space.
    rootNode?.style.setProperty('--np-gutter-inset', `${GUTTER_INSET_PX}px`);
    const applyGutterWidth = (info: monaco.editor.EditorLayoutInfo): void => {
      // Cover the glyph + line-number columns (NOT the decorations gap), so the
      // centered line numbers sit centered within the wash panel and the gap to
      // the text stays fully transparent. The raw value is Monaco-internal (from
      // the content-box origin); the CSS gradient adds --np-gutter-inset on top.
      rootNode?.style.setProperty(
        '--np-gutter-width',
        `${info.glyphMarginWidth + info.lineNumbersWidth}px`
      );
    };
    applyGutterWidth(editor.getLayoutInfo());
    const layoutSub = editor.onDidLayoutChange(applyGutterWidth);

    // --- Visibility-aware manual layout (replaces automaticLayout) ---
    // One editor is mounted per tab; inactive tabs are hidden with `display:none`,
    // so the host collapses to 0×0 while hidden and returns to real dimensions when
    // its tab is activated. Observe the host and call editor.layout() ONLY when it
    // has non-zero size — this lays out exactly once on show (the tab-switch path)
    // and skips entirely while hidden, avoiding the synchronous full relayout of a
    // large model that froze/crashed the renderer on switch. Passing explicit
    // dimensions avoids a second forced reflow inside editor.layout().
    //
    // The (width,height) dedup matters for wordWrap:'on'/'bounded': Monaco recomputes
    // line-wrapping for the ENTIRE document on a width change (O(file size)), so a
    // redundant same-size relayout on a multi-MB wrapped file is itself a main-thread
    // stall. Skipping unchanged sizes guarantees the expensive wrap pass runs at most
    // once per genuine resize/activation, never on a spurious observer callback.
    const host = hostRef.current;
    let lastW = 0;
    let lastH = 0;
    const layoutObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const width = box?.width ?? host.clientWidth;
      const height = box?.height ?? host.clientHeight;
      if (width > 0 && height > 0 && (width !== lastW || height !== lastH)) {
        lastW = width;
        lastH = height;
        // Lay out GUTTER_INSET_PX narrower than the host: .monaco-editor's
        // padding-left adds that back, so the editor's total footprint equals the
        // host width and the right-anchored vertical scrollbar stays on-screen.
        editor.layout({ width: Math.max(0, width - GUTTER_INSET_PX), height });
      }
    });
    layoutObserver.observe(host);

    const readyHandle = imperativeHandleRef.current;
    if (readyHandle) onReadyRef.current?.(readyHandle);

    // Park the live document so a remount can restore it without re-reading disk.
    return () => {
      if (!largeFileOptimizations) {
        docRef.current = model.getValue(monaco.editor.EndOfLinePreference.LF);
      } else {
        // A multi-GB model must never be copied into a second renderer string.
        // The large-file stream owns its content; its handle stays live across
        // StrictMode's effect replay.
        docRef.current = null;
      }
      disposeCommands();
      findKeysSub?.dispose();
      ctxMenuSub?.dispose();
      contentSub.dispose();
      layoutSub.dispose();
      layoutObserver.disconnect();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
    // Mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Live reconfigure of an OPEN editor (no remount) ---

  // Theme + selection/accent + line-highlight wash. Rebuild the themes (selection
  // color is accent-derived) and re-apply the active one.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    defineThemes(themeMode, accentColor);
    monaco.editor.setTheme(THEME_NAMES[themeMode]);
    editor
      .getDomNode()
      ?.style.setProperty('--np-gutter-wash', 'transparent');
  }, [themeMode, accentColor]);

  // Typography (family/size/weight/style). fontSize routes through the zoom
  // registry (setEditorZoomBase) so changing the base font keeps the active zoom
  // percent and re-applies it on the new base instead of snapping back to 100%.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ fontFamily, fontWeight: String(fontWeight) });
    setEditorZoomBase(editor, fontSize);
    const node = editor.getDomNode();
    if (node) node.style.fontStyle = fontStyle === 'normal' ? '' : fontStyle;
  }, [fontFamily, fontSize, fontWeight, fontStyle]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);
  // Line numbers.
  useEffect(() => {
    editorRef.current?.updateOptions({ lineNumbers: showLineNumbers ? 'on' : 'off' });
  }, [showLineNumbers]);

  // Word wrap.
  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
  }, [wordWrap]);

  // Line-number reveal glow (the thin boundary highlight that follows the pointer
  // near the gutter edge). Only when line numbers are shown; re-attached on theme
  // change since the glow color is theme-derived. Inert for HC / reduced-motion.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !showLineNumbers) return;
    return attachLineNumberGlow(editor, { themeMode, accentColor });
  }, [showLineNumbers, themeMode, accentColor]);

  // Current-line highlight, drawn MANUALLY. Monaco's native band is clipped to
  // `.overflow-guard` (which starts after the CSS padding-left inset), so it can't
  // reach the window's left edge; pairing it with a filler strip leaves a seam.
  // Instead native renderLineHighlight is 'none' and this overlay paints one
  // continuous full-width band behind Monaco's transparent content — from the
  // window's left edge across the gutter through the text. Only when the
  // highlighter is on; re-attached on theme change (color is theme-derived).
  // Inert for HC.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !lineHighlighter) return;
    return attachCurrentLineEdge(editor, { themeMode });
  }, [lineHighlighter, themeMode]);

  // A small top gap keeps the input area from butting against the tab strip, so
  // the active-line gray never reaches the top edge and severs the tab↔editor
  // connection. The left inset is a CSS padding-left on `.monaco-editor` (see
  // monaco-acrylic.css); Monaco can't paint the current-line band into it (it's
  // outside the clipped content region), so attachCurrentLineEdge fills that gap
  // manually. border-box keeps the inner host at the right height despite the
  // top padding.
  return (
    <div
      style={{
        height: '100%',
        boxSizing: 'border-box',
        paddingTop: 'var(--np-editor-top-gap, 6px)'
      }}
    >
      <div ref={hostRef} style={{ height: '100%' }} />
    </div>
  );
});
