import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { EditorState, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { history, defaultKeymap } from '@codemirror/commands';
import { SHADOW_EOL, normalizeToShadow } from './eol';
import type { EditorSettings } from './editorSettings';
import { editorCommandExtensions } from './commands/keymap';
import { tryInsertLogEntry } from './commands/datetime';
import { initZoomVar } from './commands/zoom';
import type { TextDirection } from './commands/direction';

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
   * Opaque extra CM6 extensions mounted AFTER the editor command keymap but
   * BEFORE the CM6 base keymap. This is the find/replace seam (Lane B): App
   * passes `[...findKeymap(callbacks), searchExtension()]` so find bindings
   * (Ctrl+F/H/G, F3/Shift+F3) and the match-highlight StateField compose in
   * without CodeMirrorEditor importing any find types.
   */
  editorExtensions?: Extension[];
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
      editorExtensions,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
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
            annotations: Transaction.addToHistory.of(false),
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
        },
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current) return;

      const extensions = [
        history(),
        editorCommandExtensions({ settings, direction, wordWrap }),
        // Find/replace seam (Lane B): mounted after our command keymap so find
        // bindings compose in, before the CM6 base keymap below.
        ...(editorExtensions ?? []),
        // CM6 base bindings AFTER our command keymap (which is Prec.high) so our
        // Tab/Enter/Mod-* overrides win; defaults still cover the rest. We DROP
        // historyKeymap and strip Mod-z/Mod-y from defaultKeymap so CM6's
        // Ctrl-z→undo never claims the slot before our undoRedoExtension `any`
        // handler (which owns undo/redo/Ctrl+Y). history() the StateField stays.
        keymap.of(
          defaultKeymap.filter(
            (b) => b.key !== 'Mod-z' && b.key !== 'Mod-y' && b.mac !== 'Mod-z',
          ),
        ),
        highlightActiveLine(),
        // Pin the document line separator to the shadow-buffer '\n' so doc
        // serialization never re-introduces CR. EOL is re-applied by MAIN.
        EditorState.lineSeparator.of(SHADOW_EOL),
        EditorView.theme({
          // Transparent surface so the window's acrylic material (single tint
          // layer on the app root) shows through the editor — matching upstream
          // Notepads, whose TextEditor RootGrid is Background="Transparent".
          '&': { height: '100%', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
        }),
      ];
      if (showLineNumbers) extensions.push(lineNumbers());

      const view = new EditorView({
        state: EditorState.create({
          // Restore the host-authoritative doc (set via setDoc) if present, so a
          // remount — incl. the StrictMode double-mount — never loses seeded text.
          // The doc enters as the INITIAL state, carrying no history (undoDepth 0).
          doc: docRef.current ?? normalizeToShadow(initialDoc),
          extensions,
        }),
        parent: hostRef.current,
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

    return <div ref={hostRef} style={{ height: '100%' }} />;
  },
);
