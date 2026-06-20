import { useEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * MarkdownPreview — RENDERER, Lane B (Phase 6). Self-contained markdown preview
 * pane. Ports the UWP MarkdownExtensionView: renders the editor's live '\n' text as
 * GFM-equivalent HTML in a pane that sits SIDE-BY-SIDE with the editor (Alt+P
 * toggles it on for .md files).
 *
 * Render pipeline lives in RUST: this component is a thin wrapper around
 * `window.notepads.markdown.render(text, hardBreaks)` (comrak + ammonia). The
 * returned HTML is ALREADY sanitized — safe to dangerouslySetInnerHTML.
 *
 * Line-break behavior is driven by `settings.strictLineBreaks` (true ⇒ strict
 * CommonMark, false ⇒ `breaks:true` behavior). The App passes that toggle in as
 * `hardBreaks = !strictLineBreaks`.
 *
 * Scroll sync (UWP-parity split behavior): the pane mirrors the Monaco editor's
 * vertical scroll position proportionally, so paging through the source pages the
 * rendered output in lock-step. The editor stays the scroll master; we subscribe to
 * editor.onDidScrollChange and map its scrollTop fraction onto our scroller.
 * The preview can also drive the editor back (two-way sync) via editor.setScrollTop.
 *
 * MOUNT API (App.tsx integration):
 *   <MarkdownPreview text={shadowText} isDark={...} editor={monacoEditor}
 *                    strictLineBreaks={settings.strictLineBreaks} />
 */

export interface MarkdownPreviewProps {
  /** The editor's live '\n'-normalized shadow text to render. */
  text: string;
  /** Dark-theme flag — toggles the preview's text/link/code palette. */
  isDark?: boolean;
  /** Optional body font size in px (defaults to 14, the editor default). */
  fontSize?: number;
  /**
   * When true (the default), use strict CommonMark line breaks (single \n is
   * whitespace inside a paragraph; only a blank line separates paragraphs).
   * When false, every \n becomes a <br>. Translates to `hardBreaks = !strict`.
   */
  strictLineBreaks?: boolean;
  /**
   * The live Monaco editor whose vertical scroll this pane mirrors. When provided,
   * the preview follows the editor's scroll fraction (the editor is the master).
   * Null/undefined falls back to an independently scrollable pane.
   */
  editor?: monaco.editor.IStandaloneCodeEditor | null;
}

/** Scoped element styling for the rendered markdown (headings, code, quotes, etc.). */
const PREVIEW_STYLES = `
.np-md-preview { padding: 12px 18px; overflow: auto; height: 100%; box-sizing: border-box;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  line-height: 1.6; word-wrap: break-word; }
.np-md-preview h1, .np-md-preview h2 { border-bottom: 1px solid rgba(128,128,128,0.35);
  padding-bottom: 0.2em; }
.np-md-preview code { font-family: Consolas, "Courier New", monospace;
  background: rgba(128,128,128,0.18); padding: 0.1em 0.35em; border-radius: 3px; }
.np-md-preview pre { background: rgba(128,128,128,0.14); padding: 10px 12px; border-radius: 4px;
  overflow: auto; }
.np-md-preview pre code { background: none; padding: 0; }
.np-md-preview blockquote { margin: 0; padding-left: 12px; color: inherit;
  border-left: 3px solid rgba(128,128,128,0.5); opacity: 0.85; }
.np-md-preview table { border-collapse: collapse; }
.np-md-preview th, .np-md-preview td { border: 1px solid rgba(128,128,128,0.4); padding: 4px 8px; }
.np-md-preview img { max-width: 100%; }
/* Task lists (comrak class names): drop the bullet, align the checkbox with its label. */
.np-md-preview ul.contains-task-list { list-style: none; padding-left: 0.4em; }
.np-md-preview li.task-list-item { display: flex; align-items: flex-start; gap: 6px; }
.np-md-preview li.task-list-item > input[type=checkbox] { margin-top: 0.35em; }
/* Footnotes. */
.np-md-preview .footnotes { font-size: 0.9em; opacity: 0.8; }
.np-md-preview .footnotes-sep { border: none; border-top: 1px solid rgba(128,128,128,0.35); }
/* GitHub-style alert blocks (NOTE / TIP / WARNING / …). */
.np-md-preview .markdown-alert { border-left: 4px solid rgba(128,128,128,0.6);
  padding: 6px 12px; margin: 1em 0; border-radius: 0 4px 4px 0; background: rgba(128,128,128,0.08); }
.np-md-preview .markdown-alert-title { font-weight: 600; margin: 0 0 4px; }
.np-md-preview .markdown-alert-note { border-left-color: #4493f8; }
.np-md-preview .markdown-alert-tip { border-left-color: #3fb950; }
.np-md-preview .markdown-alert-important { border-left-color: #ab7df8; }
.np-md-preview .markdown-alert-warning { border-left-color: #d29922; }
.np-md-preview .markdown-alert-caution { border-left-color: #f85149; }
.np-md-dark { color: #E6E6E6; }
.np-md-dark a { color: #4FA3FF; }
.np-md-light { color: #1A1A1A; }
.np-md-light a { color: #0067C0; }
`;

export function MarkdownPreview({
  text,
  isDark = false,
  fontSize = 14,
  strictLineBreaks = true,
  editor = null
}: MarkdownPreviewProps): JSX.Element {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    // Run render+sanitize asynchronously (Rust round-trip) so the toggle paint
    // is never blocked. setTimeout(0) preserves the coalescing pattern.
    const id = setTimeout(() => {
      void window.notepads.markdown.render(text, !strictLineBreaks).then((r) => {
        if (cancelled) return;
        if (r.ok) setHtml(r.data);
        // r.ok === false → keep previous html (rare; surface via console once).
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [text, strictLineBreaks]);

  const paneRef = useRef<HTMLDivElement>(null);

  // Mirror the editor's vertical scroll fraction onto this pane (editor is master).
  // Also lets the preview drive the editor back (two-way sync) via a passive scroll
  // listener on the pane. Re-wires whenever the editor instance or rendered html
  // changes (new content can change our scrollHeight).
  useEffect(() => {
    const pane = paneRef.current;
    if (!editor || !pane) return;

    let driving: 'editor' | 'preview' | null = null;

    const syncEditorToPreview = (): void => {
      if (driving === 'preview') return;
      driving = 'editor';
      const editorScrollTop = editor.getScrollTop();
      const editorScrollHeight = editor.getScrollHeight();
      const editorHeight = editor.getLayoutInfo().height;
      const editorRange = editorScrollHeight - editorHeight;
      const paneRange = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop =
        editorRange > 0 && paneRange > 0 ? (editorScrollTop / editorRange) * paneRange : 0;
      requestAnimationFrame(() => {
        driving = null;
      });
    };

    const syncPreviewToEditor = (): void => {
      if (driving === 'editor') return;
      driving = 'preview';
      const paneRange = pane.scrollHeight - pane.clientHeight;
      const editorScrollHeight = editor.getScrollHeight();
      const editorHeight = editor.getLayoutInfo().height;
      const editorRange = editorScrollHeight - editorHeight;
      editor.setScrollTop(
        paneRange > 0 && editorRange > 0 ? (pane.scrollTop / paneRange) * editorRange : 0
      );
      requestAnimationFrame(() => {
        driving = null;
      });
    };

    // Initial sync to match the editor's current scroll position.
    syncEditorToPreview();

    const scrollSub = editor.onDidScrollChange(syncEditorToPreview);
    pane.addEventListener('scroll', syncPreviewToEditor, { passive: true });

    return () => {
      scrollSub.dispose();
      pane.removeEventListener('scroll', syncPreviewToEditor);
    };
  }, [editor, html]);

  return (
    <>
      <style>{PREVIEW_STYLES}</style>
      <div
        ref={paneRef}
        data-testid="markdown-preview"
        className={isDark ? 'np-md-preview np-md-dark' : 'np-md-preview np-md-light'}
        style={{ fontSize }}
        // Safe: html is the output of the Rust ammonia sanitizer.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
