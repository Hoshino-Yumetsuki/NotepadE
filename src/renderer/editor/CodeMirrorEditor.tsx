import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Compartment, EditorState, Transaction, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine } from '@codemirror/view';
import { history, defaultKeymap } from '@codemirror/commands';
import { SHADOW_EOL } from './eol';
import { editorSettings, type EditorSettings } from './editorSettings';
import { editorCommandExtensions } from './commands/keymap';
import { tryInsertLogEntry } from './commands/datetime';
import { initZoomVar } from './commands/zoom';
import type { TextDirection } from './commands/direction';
import { setWordWrap, wordWrapCompartment, wordWrapExtension } from './commands/wordWrap';
import { lineNumberGlow, parseHexColor } from './lineNumberGlow';
import { lineNumberColumn } from './lineNumberColumn';
import { matchLanguage, highlightStyleFor, MAX_HIGHLIGHT_DOC_LENGTH } from './syntaxHighlight';
import { bigDocDispatchTransactions } from './bigDocScroll';

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
   * The document's file path (or null for untitled). Drives extension-matched
   * syntax highlighting: a recognized extension mounts its language parser
   * lazily; .txt / unknown / untitled stay plain (Notepad parity). Highlighting
   * is also gated OFF for very large documents (see MAX_HIGHLIGHT_DOC_LENGTH).
   */
  filePath?: string | null;
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

/**
 * Ensure the CSS font-family always ends with a generic monospace fallback.
 * Settings stores bare names like "Consolas"; on systems where that font is
 * absent (macOS ships no Consolas) the browser falls back to the default
 * serif/sans — producing 宋体 on Chinese locales. Appending the fallback chain
 * guarantees a monospace face even when the primary is unavailable.
 */
function withMonospaceFallback(family: string): string {
  if (family.includes('monospace')) return family;
  return `${family}, "SF Mono", Menlo, Monaco, Consolas, "Cascadia Mono", "Courier New", monospace`;
}

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
 * Per-theme selection tint built from the accent color. The accent is applied
 * as an rgba wash whose alpha differs by theme: light surfaces need LESS accent
 * (a saturated accent over white reads as a heavy block that crushes text
 * contrast), dark surfaces need MORE (the same alpha sinks into the dark
 * background and the selection becomes barely visible). rgba is used instead of
 * an `opacity` rule because `opacity` does not apply to the `::selection`
 * pseudo-element at all, and an explicit alpha also stops Chromium from
 * force-halving fully-opaque ::selection backgrounds. HC keeps the opaque
 * accent — forced-colors mode repaints selection with system Highlight anyway.
 */
function selectionColors(
  themeMode: 'light' | 'dark' | 'hc',
  accentColor: string
): { focused: string; unfocused: string } {
  const rgb = parseHexColor(accentColor);
  if (!rgb || themeMode === 'hc') {
    return { focused: accentColor, unfocused: accentColor };
  }
  const alpha =
    themeMode === 'dark' ? { focused: 0.55, unfocused: 0.38 } : { focused: 0.28, unfocused: 0.18 };
  const tint = (a: number) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  return { focused: tint(alpha.focused), unfocused: tint(alpha.unfocused) };
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
  const selection = selectionColors(themeMode, accentColor);
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
    // toggle is honored. The active line's NUMBER is brightened by the gutter
    // theme (see lineNumberColumn.ts), not a rule here.
    ...(lineHighlighter ? { '.cm-activeLine': { backgroundColor: overlay.activeLine } } : {}),
    // Line numbers are CM6's native gutter, themed in lineNumberColumn.ts
    // (transparent on light/dark so acrylic shows through; opaque Canvas under
    // HC). The gutter is laid out per-line by CM6 itself, so the numbers stay
    // aligned by construction at any zoom and any document size. Gutter color/
    // background/font rules live with that extension, not here.
    // Selection = system accent (UWP painted selection with the accent, not a
    // muted grey). The tint is an rgba wash from selectionColors(): lighter
    // alpha on light themes (so a saturated accent never crushes selected-text
    // contrast over white) and heavier alpha on dark themes (so the same accent
    // doesn't sink into the dark surface and vanish). rgba — not an `opacity`
    // rule — because opacity never applies to `::selection`, which previously
    // left the native selection layer fully opaque on light themes. Both the
    // focused and unfocused layers are colored so a blurred editor (e.g. while
    // the find box has focus) still shows its selection, slightly fainter.
    // (`&.cm-focused` / `&:not(.cm-focused)` are root+class selectors CM6 DOES
    // support.)
    '.cm-content ::selection': { backgroundColor: selection.focused },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: selection.focused },
    '&:not(.cm-focused) .cm-selectionBackground': { backgroundColor: selection.unfocused },
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
      fontFamily: fontFamilyRaw = DEFAULT_FONT_FAMILY,
      fontSize = DEFAULT_FONT_SIZE,
      fontStyle = 'normal',
      fontWeight = 400,
      accentColor = DEFAULT_ACCENT,
      filePath = null,
      editorExtensions,
      onDocChanged
    },
    ref
  ) {
    // Ensure the font-family always has a monospace fallback so systems missing
    // the primary face (e.g. macOS without Consolas) fall back to a monospace
    // font instead of the browser default serif (宋体 on CJK locales).
    const fontFamily = withMonospaceFallback(fontFamilyRaw);

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
    // Syntax highlighting, split into two compartments:
    //   - languageCompartment:  the (lazily loaded) language parser matched from
    //                           the file extension; [] for plain/untitled/huge docs
    //   - highlightCompartment: the theme-matched token-color HighlightStyle
    // Both reconfigure live (open/save-as renames, theme switches) — no remount.
    const languageCompartment = useRef(new Compartment());
    const highlightCompartment = useRef(new Compartment());
    // Monotonic token so a slow lazy language load can never apply over a newer
    // match (rapid path changes, or path cleared while a parser chunk loads).
    const languageLoadToken = useRef(0);
    // Latest filePath, read by setDoc to re-run the size gate after an
    // authoritative load lands a (possibly huge) document in the view.
    const filePathRef = useRef<string | null>(filePath);
    filePathRef.current = filePath;
    // The host-authoritative document. setDoc parks text here ONLY while no view
    // exists; once a live view holds the doc this is cleared and re-captured from
    // the view in the mount-effect cleanup, so a remount restores it. This matters
    // because React 18 StrictMode double-invokes the mount effect (create → destroy
    // → recreate): a one-shot "flush on first mount" queue would seed the first,
    // soon-destroyed view, and the recreated view would start from the empty
    // initialDoc — the cold-start argv-open empty-doc bug. Clearing it while a view
    // is live matters for LARGE files: keeping the full normalized string here
    // alongside the CM6 doc permanently retains a duplicate copy (~120MB extra on
    // a 120MB file). null = use initialDoc (or the view already owns the doc).
    // The cleanup re-capture stores the CM6 Text ROPE (not a string): Text is
    // immutable pure data that survives view.destroy(), EditorState.create
    // accepts it directly, and referencing it is O(1) — materializing
    // doc.toString() here instead built a full-size transient copy on EVERY
    // unmount including the FINAL tab close (~+1.3GB spike closing a 1.2GB doc).
    const docRef = useRef<string | Text | null>(null);

    // Resolve + mount the language for the CURRENT filePath/doc-size into the
    // language compartment. Reads only refs, so the one instance created on
    // first render is safe to call from the mount-once effect, setDoc, and the
    // filePath effect alike. Lazy: a recognized extension dynamically imports
    // its parser chunk; the token guard discards a load that finishes after a
    // newer call (rapid open/save-as, or the doc grew past the gate meanwhile).
    const applyLanguageRef = useRef(() => {
      const view = viewRef.current;
      if (!view) return;
      const token = ++languageLoadToken.current;
      const path = filePathRef.current;
      // Perf gate: huge documents never mount a parser (protects the lean
      // large-file path); plain/unknown/untitled files stay unhighlighted.
      const desc =
        view.state.doc.length <= MAX_HIGHLIGHT_DOC_LENGTH ? matchLanguage(path) : null;
      if (!desc) {
        view.dispatch({ effects: languageCompartment.current.reconfigure([]) });
        return;
      }
      if (desc.support) {
        view.dispatch({ effects: languageCompartment.current.reconfigure(desc.support) });
        return;
      }
      void desc.load().then(
        (support) => {
          const live = viewRef.current;
          if (!live || token !== languageLoadToken.current) return; // superseded
          live.dispatch({ effects: languageCompartment.current.reconfigure(support) });
        },
        () => {
          // Parser chunk failed to load (shouldn't happen in a packaged app) —
          // stay plain rather than surfacing an error for cosmetic highlighting.
        }
      );
    });

    useImperativeHandle(
      ref,
      (): CodeMirrorHandle => ({
        setDoc(text: string): void {
          // A host setDoc is always an AUTHORITATIVE load (open / activation /
          // cross-window adopt / reload), applied WITHOUT a history entry: a
          // freshly loaded or adopted document must have undoDepth 0 so Ctrl+Z
          // is a no-op and never blanks the just-loaded content (the source's
          // undo stack does not transfer). With no view yet, PARK the text in
          // docRef for the mount effect; with a live view, hand the string to
          // CM6 and deliberately do NOT also retain it in docRef — a duplicate
          // retained copy doubles memory on large files (see docRef comment).
          const view = viewRef.current;
          if (!view) {
            docRef.current = text;
            return;
          }
          docRef.current = null;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: Transaction.addToHistory.of(false)
          });
          // Re-run the language match: the SIZE gate depends on the freshly
          // loaded doc (a huge file must drop any mounted parser, and a small
          // one may now qualify under an already-known path).
          applyLanguageRef.current();
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
        // Syntax highlighting: language parser (empty until the lazy match
        // resolves — see applyLanguage) + theme-matched token colors. Mounted
        // FIRST so every later keymap/theme extension wins any conflicts.
        languageCompartment.current.of([]),
        highlightCompartment.current.of(highlightStyleFor(themeMode)),
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
        // mounts/unmounts the gutter live. CM6's native lineNumbers() gutter,
        // themed in lineNumberColumn.ts — structurally aligned per line at any
        // zoom and any document size.
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
          // Restore the host-authoritative doc (parked via setDoc or re-captured
          // by the previous cleanup) if present, so a remount — incl. the
          // StrictMode double-mount — never loses seeded text. The doc enters as
          // the INITIAL state, carrying no history (undoDepth 0).
          doc: docRef.current ?? initialDoc,
          extensions
        }),
        parent: hostRef.current,
        // Big-document scroll stabilizer: in ~410k+ line docs CM6's BigScaler
        // rescales the whole height model on every edit, and the anchor-diff
        // correction CM6 would apply is skipped whenever the transaction
        // carries a scroll target (typing always does). This wrapper captures
        // a pixel-exact pre-edit scroll snapshot for big-doc user edits and
        // re-applies it after the edit, pinning the caret line and everything
        // above it at their exact screen y. See bigDocScroll.ts. A pass-
        // through below the line threshold.
        dispatchTransactions: bigDocDispatchTransactions
      });
      // The view owns the document now. Drop the parked string so a large file
      // is retained ONCE (inside CM6's rope), not twice (see docRef comment).
      docRef.current = null;
      viewRef.current = view;
      // Seed the zoom CSS variable so the initial font-size reflects 100%.
      initZoomVar(view);
      // Match the language for a path known at mount (e.g. argv-open whose doc
      // was parked in docRef before the editor existed).
      applyLanguageRef.current();

      return () => {
        // Re-capture the live doc before destroying so a REMOUNT (StrictMode
        // double-mount, key change) restores it. Keep the immutable CM6 Text
        // rope itself — NOT doc.toString(), which materializes a full-size
        // string copy on every unmount (on the FINAL close of a large tab that
        // transient copy was the user-visible close-time memory spike). The
        // rope is plain immutable data, valid after destroy(), and the next
        // mount hands it straight back to EditorState.create. On a final
        // unmount the ref is discarded with the component instance.
        docRef.current = view.state.doc;
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

    // Line-number gutter mount/unmount + live rebuild. The gutter theme bakes in
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

    // Language: re-match when the file path changes (open into this editor,
    // Save As rename). The callback also re-checks the doc-size perf gate.
    useEffect(() => {
      applyLanguageRef.current();
    }, [filePath]);

    // Token colors follow the app theme (light/dark/hc) live.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: highlightCompartment.current.reconfigure(highlightStyleFor(themeMode))
      });
    }, [themeMode]);

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
