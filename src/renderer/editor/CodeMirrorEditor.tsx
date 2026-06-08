import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
import { history, defaultKeymap } from '@codemirror/commands';
import { SHADOW_EOL, normalizeToShadow } from './eol';
import { editorSettings, type EditorSettings } from './editorSettings';
import { editorCommandExtensions } from './commands/keymap';
import { tryInsertLogEntry } from './commands/datetime';
import { initZoomVar } from './commands/zoom';
import type { TextDirection } from './commands/direction';
import { setWordWrap, wordWrapCompartment, wordWrapExtension } from './commands/wordWrap';
import { lineNumberGlow } from './lineNumberGlow';
import { lineNumberColumn } from './lineNumberColumn';

/**
 * Imperative handle the host (App) uses to drive the editor without owning the
 * CM6 instance. The host loads authoritative decoded text via `setDoc` and reads
 * the current '\n'-normalized shadow buffer via `getShadowText` on save.
 */
export interface CodeMirrorHandle {
  /**
   * Replace the entire document with `text`, normalized to the '\n' shadow
   * buffer. Used when MAIN delivers an authoritative {decodedText} over IPC.
   */
  setDoc(text: string): void;
  /** Current document as a '\n'-normalized shadow-buffer string (for save). */
  getShadowText(): string;
  /** Focus the editor surface. */
  focus(): void;
  /**
   * Attempt the `.LOG` once-per-open auto-timestamp. No-op unless the document
   * starts with ".LOG" and the per-editor guard is still unset. The host calls
   * this exactly once right after loading a file (mirrors UWP TryInsertNewLogEntry
   * fired on load).
   */
  tryInsertLogEntry(): boolean;
  /**
   * The live CM6 view, or null before mount / after unmount. Lets the find/
   * replace controller (Lane B) and harness drive the same instance the host
   * owns, without a second editor surface.
   */
  getView(): EditorView | null;
}

export interface CodeMirrorEditorProps {
  /** Initial document (will be '\n'-normalized). Defaults to empty. */
  initialDoc?: string;
  /** Whether to render the gutter line numbers. */
  lineNumbers?: boolean;
  /** Host-provided editor-behavior settings (tab width, smart-copy, etc.). */
  settings?: Partial<EditorSettings>;
  /** Initial text direction. Defaults to 'ltr'. */
  direction?: TextDirection;
  /** Initial word-wrap state. Defaults to false (NoWrap). */
  wordWrap?: boolean;
  /**
   * Whether the current-line highlight is shown (UWP DisplayLineHighlighter /
   * "Highlight current line" toggle). Gates BOTH the highlightActiveLine()
   * extension and the .cm-activeLine(+Gutter) theme rules. Defaults to true.
   */
  lineHighlighter?: boolean;
  /**
   * Resolved app-theme bucket, threaded EXPLICITLY so the theme builder can pick
   * light/dark/hc colors in JS and emit them on PLAIN selectors. CM6's
   * EditorView.theme does NOT support `&dark`/`&light`-style ancestor selectors —
   * passing one throws `RangeError: Unsupported selector` at construction, the
   * editor mount throws, and (with no error boundary) the WHOLE app unmounts.
   * Defaults to 'light'.
   */
  themeMode?: 'light' | 'dark' | 'hc';
  /**
   * Editor typography, sourced 1:1 from the persisted Settings bag
   * (editorFontFamily / editorFontSize / editorFontStyle / editorFontWeight).
   * The host passes these through so the CM6 surface paints with the same
   * Consolas-14 default the UWP RichEditBox used; each is optional and falls back
   * to the UWP default below.
   */
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontWeight?: number;
  /**
   * Selection-highlight color (the resolved app accent, #RRGGBB). The UWP
   * RichEditBox painted its selection with the system accent, NOT a muted grey;
   * we mirror that. Defaults to Windows blue (#0078D4).
   */
  accentColor?: string;
  /**
   * Opaque extra CM6 extensions mounted AFTER the editor command keymap but
   * BEFORE the CM6 base keymap. This is the find/replace seam (Lane B): App
   * passes `[...findKeymap(callbacks), searchExtension()]` so find bindings
   * (Ctrl+F/H/G, F3/Shift+F3) and the match-highlight StateField compose in
   * without CodeMirrorEditor importing any find types.
   */
  editorExtensions?: Extension[];
  /**
   * Fired whenever the document content changes (CM6 `update.docChanged`). The
   * host (App) compares `getShadowText()` to the per-tab last-saved baseline to
   * drive the dirty flag (tab dot + status-bar "Modified"). Backed by a ref so a
   * changing callback identity never remounts the editor.
   */
  onDocChanged?: () => void;
}

/** UWP RichEditBox defaults (Consolas 14, normal/400) — used when no setting. */
const DEFAULT_FONT_FAMILY = 'Consolas, "Cascadia Code", "Cascadia Mono", monospace';
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_ACCENT = '#0078D4';

/** The typography/selection/scrollbar inputs the editor theme is built from. */
interface EditorThemeOptions {
  fontFamily: string;
  fontStyle: 'normal' | 'italic' | 'oblique';
  fontWeight: number;
  accentColor: string;
  /** When false, the .cm-activeLine(+Gutter) highlight rules are omitted. */
  lineHighlighter: boolean;
  /** Resolved theme bucket — picks active-line/scrollbar tints in JS. */
  themeMode: 'light' | 'dark' | 'hc';
}

/**
 * Per-theme overlay tints chosen in JS (NOT via CM6 `&dark` selectors, which are
 * unsupported and throw at construction). Active-line is a subtle wash over the
 * transparent editor surface — white-ish on dark, grey on light; the Win11
 * scrollbar thumb mirrors the UWP OS default (#898989 light / #8A8A8A dark).
 */
function themeOverlays(themeMode: 'light' | 'dark' | 'hc'): {
  activeLine: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
} {
  if (themeMode === 'dark') {
    return {
      activeLine: 'rgba(255, 255, 255, 0.05)',
      scrollbarThumb: 'rgba(138, 138, 138, 0.35)',
      scrollbarThumbHover: 'rgba(138, 138, 138, 0.6)'
    };
  }
  // light + hc share the grey-on-light overlay (HC paints opaque system colors
  // anyway, so the faint wash is a no-op there).
  return {
    activeLine: 'rgba(127, 127, 127, 0.08)',
    scrollbarThumb: 'rgba(137, 137, 137, 0.35)',
    scrollbarThumbHover: 'rgba(137, 137, 137, 0.6)'
  };
}

/**
 * Build the editor `EditorView.theme`. Pure in its options so it can be rebuilt
 * inside a Compartment and dispatched via `reconfigure` when any typography /
 * accent / line-highlighter / theme prop changes on an already-open editor (no
 * remount, so undo history + scroll survive). font-SIZE is deliberately NOT set
 * here — it is owned by the zoom CSS variable driven by the editorSettings facet.
 *
 * IMPORTANT: only `&` (editor root), `&.cm-focused` / `&:not(.cm-focused)` (root
 * + standard class) and plain `.cm-*` descendant selectors are used. CM6's
 * EditorView.theme throws `RangeError: Unsupported selector` on `&dark`-style
 * ancestor selectors, so per-theme colors are chosen in JS (themeOverlays).
 */
function buildEditorTheme(opts: EditorThemeOptions): Extension {
  const { fontFamily, fontStyle, fontWeight, accentColor, lineHighlighter, themeMode } = opts;
  const overlay = themeOverlays(themeMode);
  return EditorView.theme({
    // Transparent surface so the window's acrylic material (single tint layer on
    // the app root) shows through the editor — matching upstream Notepads, whose
    // TextEditor RootGrid is Background="Transparent".
    '&': { height: '100%', backgroundColor: 'transparent' },
    // Typography: UWP RichEditBox was Consolas 14 with a TIGHT line-height (≈ the
    // font size) and content padding 6/6/10/6 (L/T/R/B). font-size is owned by
    // the zoom variable — set only family/style/weight/line-height/padding here.
    '.cm-content': {
      fontFamily,
      fontStyle,
      fontWeight: String(fontWeight),
      lineHeight: '1.2',
      // CM6 owns horizontal padding via .cm-line; vertical padding here.
      padding: '6px 0 10px 0',
      caretColor: 'currentColor'
    },
    '.cm-line': { padding: '0 6px' },
    '.cm-scroller': {
      overflow: 'auto',
      lineHeight: '1.2',
      // Thin always-visible scrollbar: ~6px thumb, transparent track that
      // reserves no layout gutter. Thumb tints mirror the UWP OS default:
      // #898989 light / #8A8A8A dark, semi-transparent.
      scrollbarWidth: 'thin',
      scrollbarColor: `${overlay.scrollbarThumb} transparent`
    },
    // Active line: the CM6 default highlight is invisible on our transparent
    // surface, so paint an explicit subtle overlay (per-theme tint from
    // themeOverlays). Gated on lineHighlighter so the "Highlight current line"
    // toggle is honored. The active line's NUMBER is brightened by the external
    // line-number column itself (see lineNumberColumn.ts), not a gutter rule.
    ...(lineHighlighter ? { '.cm-activeLine': { backgroundColor: overlay.activeLine } } : {}),
    // Line numbers are NOT a CM6 gutter here — they render in a separate external
    // column (lineNumberColumn.ts) positioned OUTSIDE the horizontal scroller, so
    // document text never travels behind them. That is the only structure where the
    // column can be transparent (acrylic shows through) AND never overlap text; a
    // sticky in-scroller gutter cannot be both. See lineNumberColumn.ts for the full
    // rationale. Consequently there are no `.cm-gutters` / `.cm-lineNumbers` rules.
    // Selection = system accent (UWP painted selection with the accent, not a
    // muted grey). Color BOTH focused and unfocused selection layers so a blurred
    // editor (e.g. while a find box has focus) still shows it. The FOCUSED layer
    // uses ~0.4 alpha so saturated accents never crush selected-text contrast on
    // light themes; the unfocused layer is fainter still. (`&.cm-focused` and
    // `&:not(.cm-focused)` are root+class selectors CM6 DOES support.)
    '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: accentColor },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: accentColor, opacity: 0.4 },
    '&:not(.cm-focused) .cm-selectionBackground': { backgroundColor: accentColor, opacity: 0.3 },
    // Thin always-visible scrollbar thumb (webkit). Transparent track, ~6px
    // visible thumb that darkens on hover.
    '.cm-scroller::-webkit-scrollbar': { width: '12px', height: '12px' },
    '.cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: overlay.scrollbarThumb,
      borderRadius: '6px',
      border: '3px solid transparent',
      backgroundClip: 'content-box'
    },
    '.cm-scroller:hover::-webkit-scrollbar-thumb': {
      backgroundColor: overlay.scrollbarThumbHover
    }
  });
}

/**
 * CodeMirror 6 editor mount (RENDERER, Lane B). One EditorView over an
 * EditorState whose document is the '\n'-normalized shadow buffer.
 *
 * The shadow buffer is for editing ONLY. Encoding/EOL labels live in host state
 * and are NEVER re-derived from this document (docs/plan/04 §3.A authority
 * contract). Renders CM6's `.cm-content` surface, which the Gate-1 e2e asserts.
 *
 * All Phase-3 editor commands (duplicate, join, indent, move, datetime, zoom,
 * direction, word-wrap, web search, smart-copy, swallows) are mounted through
 * `editorCommandExtensions()` from ./commands/keymap.
 */
export const CodeMirrorEditor = forwardRef<CodeMirrorHandle, CodeMirrorEditorProps>(
  function CodeMirrorEditor(
    {
      initialDoc = '',
      lineNumbers: showLineNumbers = false,
      settings,
      direction = 'ltr',
      wordWrap = false,
      lineHighlighter = true,
      themeMode = 'light',
      fontFamily = DEFAULT_FONT_FAMILY,
      fontSize = DEFAULT_FONT_SIZE,
      fontStyle = 'normal',
      fontWeight = 400,
      accentColor = DEFAULT_ACCENT,
      editorExtensions,
      onDocChanged
    },
    ref
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    // Latest onDocChanged callback, read by the mount-once updateListener below.
    // A ref (not a dep) keeps the listener stable so a changing callback identity
    // never remounts the editor (which would drop undo history + scroll).
    const onDocChangedRef = useRef<(() => void) | undefined>(onDocChanged);
    onDocChangedRef.current = onDocChanged;
    // Per-instance CM6 Compartments so live prop changes reconfigure THIS open
    // editor (no remount → undo history + scroll position survive). One per
    // independently-reconfigurable concern:
    //   - themeCompartment:      typography + selection/accent + active-line rules
    //   - lineNumbersCompartment: lineNumbers() mounted iff the prop is true
    //   - activeLineCompartment:  highlightActiveLine() mounted iff lineHighlighter
    //   - fontSizeCompartment:    an editorSettings.of({ fontSize }) input that
    //                             wins last (zoom reads fontSize off this facet)
    // Word-wrap reuses the shared wordWrapCompartment (the Alt+Z command owns it).
    const themeCompartment = useRef(new Compartment());
    const lineNumbersCompartment = useRef(new Compartment());
    const activeLineCompartment = useRef(new Compartment());
    const fontSizeCompartment = useRef(new Compartment());
    // Line-number REVEAL glow (UWP LineNumberGrid reveal border brush). Gated on
    // showLineNumbers (no gutter → no glow) AND rebuilt on themeMode/accentColor
    // so the bloom matches the live theme + accent. Self-contained in
    // lineNumberGlow.ts; paints an inline-styled overlay (no CM6 theme selector).
    const lineNumberGlowCompartment = useRef(new Compartment());
    // The host-authoritative document. setDoc updates this and the view is rebuilt
    // FROM it on every mount, so seeded text survives a remount. This matters
    // because React 18 StrictMode double-invokes the mount effect (create → destroy
    // → recreate): a one-shot "flush on first mount" queue would seed the first,
    // soon-destroyed view, and the recreated view would start from the empty
    // initialDoc — the cold-start argv-open empty-doc bug. null = use initialDoc.
    const docRef = useRef<string | null>(null);

    useImperativeHandle(
      ref,
      (): CodeMirrorHandle => ({
        setDoc(text: string): void {
          const normalized = normalizeToShadow(text);
          // A host setDoc is always an AUTHORITATIVE load (open / activation /
          // cross-window adopt / reload). Remember it so a remount restores it,
          // and apply it WITHOUT a history entry: a freshly loaded or adopted
          // document must have undoDepth 0 so Ctrl+Z is a no-op and never blanks
          // the just-loaded content (the source's undo stack does not transfer).
          docRef.current = normalized;
          const view = viewRef.current;
          if (!view) return; // applied on mount from docRef
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: normalized },
            annotations: Transaction.addToHistory.of(false)
          });
        },
        getShadowText(): string {
          const view = viewRef.current;
          // CM6 doc.toString() joins lines with the state's lineSeparator; we
          // pin it to '\n' below so this is always the shadow buffer verbatim.
          return view ? view.state.doc.toString() : '';
        },
        focus(): void {
          viewRef.current?.focus();
        },
        tryInsertLogEntry(): boolean {
          const view = viewRef.current;
          return view ? tryInsertLogEntry(view) : false;
        },
        getView(): EditorView | null {
          return viewRef.current;
        }
      }),
      []
    );

    useEffect(() => {
      if (!hostRef.current) return;

      const extensions = [
        history(),
        // Dirty-tracking seam: fire the host's onDocChanged on any document edit
        // (NOT selection/viewport-only updates). Read through a ref so the
        // listener is mounted once and never forces a remount. setDoc dispatches
        // with addToHistory:false but STILL reports docChanged — the host treats
        // an authoritative load as "clean" by re-baselining, so that's correct.
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onDocChangedRef.current?.();
        }),
        // The editor command bundle mounts editorSettings.of(settings) + the
        // direction/word-wrap compartments + zoom. We pass settings WITHOUT
        // fontSize here and instead provide fontSize through our own
        // fontSizeCompartment below (a later, last-wins editorSettings input) so
        // the base font-size can be reconfigured live without a remount.
        editorCommandExtensions({ settings, direction, wordWrap }),
        // Live base font-size: an editorSettings facet input mounted AFTER the
        // command bundle, so its fontSize wins (combine = last-writer-wins). Zoom
        // derives `.cm-content` font-size from this facet × zoom percent.
        fontSizeCompartment.current.of(editorSettings.of({ fontSize })),
        // Find/replace seam (Lane B): mounted after our command keymap so find
        // bindings compose in, before the CM6 base keymap below.
        ...(editorExtensions ?? []),
        // CM6 base bindings AFTER our command keymap (which is Prec.high) so our
        // Tab/Enter/Mod-* overrides win; defaults still cover the rest. We DROP
        // historyKeymap and strip Mod-z/Mod-y from defaultKeymap so CM6's
        // Ctrl-z→undo never claims the slot before our undoRedoExtension `any`
        // handler (which owns undo/redo/Ctrl+Y). history() the StateField stays.
        keymap.of(
          defaultKeymap.filter((b) => b.key !== 'Mod-z' && b.key !== 'Mod-y' && b.mac !== 'Mod-z')
        ),
        // highlightActiveLine() gated on lineHighlighter, in a compartment so the
        // "Highlight current line" toggle reconfigures it live.
        activeLineCompartment.current.of(lineHighlighter ? highlightActiveLine() : []),
        // Pin the document line separator to the shadow-buffer '\n' so doc
        // serialization never re-introduces CR. EOL is re-applied by MAIN.
        EditorState.lineSeparator.of(SHADOW_EOL),
        // Typography / selection / scrollbar theme, in a compartment for live
        // reconfigure on font*/accentColor/lineHighlighter changes.
        themeCompartment.current.of(
          buildEditorTheme({
            fontFamily,
            fontStyle,
            fontWeight,
            accentColor,
            lineHighlighter,
            themeMode
          })
        ),
        // Line numbers gated on the prop, in a compartment so toggling the setting
        // mounts/unmounts the external column live. NOT CM6's lineNumbers() — an
        // out-of-scroller column so it stays transparent without text overlap.
        lineNumbersCompartment.current.of(
          showLineNumbers ? lineNumberColumn({ themeMode, fontFamily, lineHighlighter }) : []
        ),
        // Line-number reveal glow, mounted iff the gutter is shown. Empty when off
        // so there is no overlay/listeners without a gutter to light.
        lineNumberGlowCompartment.current.of(
          showLineNumbers ? lineNumberGlow({ themeMode, accentColor }) : []
        )
      ];

      const view = new EditorView({
        state: EditorState.create({
          // Restore the host-authoritative doc (set via setDoc) if present, so a
          // remount — incl. the StrictMode double-mount — never loses seeded text.
          // The doc enters as the INITIAL state, carrying no history (undoDepth 0).
          doc: docRef.current ?? normalizeToShadow(initialDoc),
          extensions
        }),
        parent: hostRef.current
      });
      viewRef.current = view;
      // Seed the zoom CSS variable so the initial font-size reflects 100%.
      initZoomVar(view);

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Mount once; document updates flow through the imperative handle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Live reconfigure of an OPEN editor (no remount; undo + scroll survive) ---
    // Each effect dispatches a Compartment.reconfigure when its inputs change, so a
    // Settings change (font, line numbers, word-wrap, accent/theme, line highlight)
    // applies to the already-open document instead of only at the next mount.

    // Typography + selection/accent + active-line + per-theme overlays.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.current.reconfigure(
          buildEditorTheme({
            fontFamily,
            fontStyle,
            fontWeight,
            accentColor,
            lineHighlighter,
            themeMode
          })
        )
      });
    }, [fontFamily, fontStyle, fontWeight, accentColor, lineHighlighter, themeMode]);

    // Base font-size (the editorSettings facet input the zoom system reads). Also
    // re-seed the zoom CSS variable so the new base size paints immediately.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: fontSizeCompartment.current.reconfigure(editorSettings.of({ fontSize }))
      });
      initZoomVar(view);
    }, [fontSize]);

    // Line-number column mount/unmount + live rebuild. The external column bakes in
    // themeMode/fontFamily/lineHighlighter (number color, font face, active-line
    // emphasis), so a change to any of those rebuilds it — same lane as the glow.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: lineNumbersCompartment.current.reconfigure(
          showLineNumbers ? lineNumberColumn({ themeMode, fontFamily, lineHighlighter }) : []
        )
      });
    }, [showLineNumbers, themeMode, fontFamily, lineHighlighter]);

    // Line-number reveal glow: re-derive when the gutter is toggled OR the theme/
    // accent changes (the glow tint is baked in at build time to keep the
    // per-pointer path free of facet reads, so a theme/accent switch rebuilds it).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: lineNumberGlowCompartment.current.reconfigure(
          showLineNumbers ? lineNumberGlow({ themeMode, accentColor }) : []
        )
      });
    }, [showLineNumbers, themeMode, accentColor]);

    // Current-line highlight extension mount/unmount (theme rules are gated above).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: activeLineCompartment.current.reconfigure(
          lineHighlighter ? highlightActiveLine() : []
        )
      });
    }, [lineHighlighter]);

    // Word-wrap: reuse the shared wordWrapCompartment (the Alt+Z command owns it),
    // keeping the wordWrapField boolean in sync via setWordWrap exactly as the
    // toggle command does, so a later Alt+Z reads the correct current state.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [
          setWordWrap.of(wordWrap),
          wordWrapCompartment.reconfigure(wordWrapExtension(wordWrap))
        ]
      });
    }, [wordWrap]);

    return <div ref={hostRef} style={{ height: '100%' }} />;
  }
);
