import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { SHADOW_EOL, normalizeToShadow } from './eol';

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
}

export interface CodeMirrorEditorProps {
  /** Initial document (will be '\n'-normalized). Defaults to empty. */
  initialDoc?: string;
  /** Whether to render the gutter line numbers. */
  lineNumbers?: boolean;
}

/**
 * CodeMirror 6 editor mount (RENDERER, Lane B). One EditorView over an
 * EditorState whose document is the '\n'-normalized shadow buffer.
 *
 * The shadow buffer is for editing ONLY. Encoding/EOL labels live in host state
 * and are NEVER re-derived from this document (docs/plan/04 §3.A authority
 * contract). Renders CM6's `.cm-content` surface, which the Gate-1 e2e asserts.
 */
export const CodeMirrorEditor = forwardRef<CodeMirrorHandle, CodeMirrorEditorProps>(
  function CodeMirrorEditor({ initialDoc = '', lineNumbers: showLineNumbers = false }, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    useImperativeHandle(
      ref,
      (): CodeMirrorHandle => ({
        setDoc(text: string): void {
          const view = viewRef.current;
          if (!view) return;
          const normalized = normalizeToShadow(text);
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: normalized },
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
      }),
      [],
    );

    useEffect(() => {
      if (!hostRef.current) return;

      const extensions = [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlightActiveLine(),
        // Pin the document line separator to the shadow-buffer '\n' so doc
        // serialization never re-introduces CR. EOL is re-applied by MAIN.
        EditorState.lineSeparator.of(SHADOW_EOL),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ];
      if (showLineNumbers) extensions.push(lineNumbers());

      const view = new EditorView({
        state: EditorState.create({
          doc: normalizeToShadow(initialDoc),
          extensions,
        }),
        parent: hostRef.current,
      });
      viewRef.current = view;

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
