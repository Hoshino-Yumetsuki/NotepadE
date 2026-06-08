import { useEffect, useMemo, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { renderMarkdown } from './renderMarkdown';
import { sanitizeMarkdownHtml } from './sanitizeHtml';

/**
 * MarkdownPreview — RENDERER, Lane B (Phase 6). Self-contained markdown preview
 * pane. Ports the UWP MarkdownExtensionView: renders the editor's live '\n' text as
 * GFM-equivalent HTML (see renderMarkdown.ts) in a pane that sits SIDE-BY-SIDE with
 * the editor (Alt+P toggles it on for .md files).
 *
 * Safety: `renderMarkdown` now runs markdown-it with html:true, so its output is
 * UNTRUSTED. This component routes it through `sanitizeMarkdownHtml` (DOMPurify +
 * an image-source policy) BEFORE dangerouslySetInnerHTML. The sanitized string is
 * the only thing injected — that pass is the XSS gate, not html:false anymore.
 *
 * Scroll sync (UWP-parity split behavior): the pane is NOT an independently
 * scrolling view. It mirrors the EDITOR's vertical scroll position proportionally,
 * so paging through the source pages the rendered output in lock-step. The editor
 * stays the scroll master; we listen to its CM6 scrollDOM and map its scroll
 * fraction onto our own scroller. (UWP synced the diff viewer's two panes the same
 * way via ScrollViewerSynchronizer; here we sync editor -> preview.)
 *
 * Styling follows the codebase convention (inline styles + a scoped <style> block).
 * The scoped block targets only `.np-md-preview` descendants so it cannot leak.
 *
 * MOUNT API (App.tsx integration):
 *   <MarkdownPreview text={shadowText} isDark={...} editorView={view} />
 */

export interface MarkdownPreviewProps {
  /** The editor's live '\n'-normalized shadow text to render. */
  text: string;
  /** Dark-theme flag — toggles the preview's text/link/code palette. */
  isDark?: boolean;
  /** Optional body font size in px (defaults to 14, the editor default). */
  fontSize?: number;
  /**
   * The editor's CM6 view whose vertical scroll this pane mirrors. When provided,
   * the preview follows the editor's scroll fraction (the editor is the master).
   * Null/undefined falls back to an independently scrollable pane.
   */
  editorView?: EditorView | null;
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
.np-md-preview figure { margin: 1em 0; }
.np-md-preview figcaption { font-size: 0.9em; opacity: 0.75; text-align: center; margin-top: 4px; }
/* Task lists: drop the list bullet, align the checkbox with its label. */
.np-md-preview .task-list-container { list-style: none; padding-left: 0.4em; }
.np-md-preview .task-list-item { display: flex; align-items: flex-start; gap: 6px; }
.np-md-preview .task-list-item-checkbox { margin-top: 0.35em; }
/* Footnotes. */
.np-md-preview .footnotes { font-size: 0.9em; opacity: 0.8; }
.np-md-preview .footnotes-sep { border: none; border-top: 1px solid rgba(128,128,128,0.35); }
/* Marks / inserts keep readable contrast in both themes. */
.np-md-preview mark { background: rgba(255, 221, 87, 0.55); color: inherit; padding: 0 0.15em; }
/* Spoiler: hidden until hovered/focused. */
.np-md-preview .spoiler { background: currentColor; border-radius: 3px; transition: background 0.1s; }
.np-md-preview .spoiler:hover, .np-md-preview .spoiler:focus { background: transparent; }
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
/* highlight.js token colors — light theme (GitHub-style). */
.np-md-light .hljs-keyword, .np-md-light .hljs-selector-tag, .np-md-light .hljs-built_in { color: #d73a49; }
.np-md-light .hljs-string, .np-md-light .hljs-attr { color: #032f62; }
.np-md-light .hljs-comment, .np-md-light .hljs-meta { color: #6a737d; font-style: italic; }
.np-md-light .hljs-number, .np-md-light .hljs-literal { color: #005cc5; }
.np-md-light .hljs-title, .np-md-light .hljs-function { color: #6f42c1; }
.np-md-light .hljs-type, .np-md-light .hljs-class, .np-md-light .hljs-variable { color: #e36209; }
/* highlight.js token colors — dark theme (VS Code-ish). */
.np-md-dark .hljs-keyword, .np-md-dark .hljs-selector-tag, .np-md-dark .hljs-built_in { color: #f97583; }
.np-md-dark .hljs-string, .np-md-dark .hljs-attr { color: #9ecbff; }
.np-md-dark .hljs-comment, .np-md-dark .hljs-meta { color: #6a737d; font-style: italic; }
.np-md-dark .hljs-number, .np-md-dark .hljs-literal { color: #79b8ff; }
.np-md-dark .hljs-title, .np-md-dark .hljs-function { color: #b392f0; }
.np-md-dark .hljs-type, .np-md-dark .hljs-class, .np-md-dark .hljs-variable { color: #ffab70; }
`;

export function MarkdownPreview({
  text,
  isDark = false,
  fontSize = 14,
  editorView = null
}: MarkdownPreviewProps): JSX.Element {
  // Re-render only when the source text changes. Render (markdown-it) then
  // sanitize (DOMPurify) — both are pure transforms keyed on the text.
  const html = useMemo(() => sanitizeMarkdownHtml(renderMarkdown(text)), [text]);

  const paneRef = useRef<HTMLDivElement>(null);

  // Mirror the editor's vertical scroll fraction onto this pane. The editor is the
  // scroll master; we are a follower. Re-applied whenever the editor view or the
  // rendered html changes (new content can change our scrollHeight).
  useEffect(() => {
    const scroller = editorView?.scrollDOM;
    const pane = paneRef.current;
    if (!scroller || !pane) return;

    let driving: 'editor' | 'preview' | null = null;

    const syncEditorToPreview = (): void => {
      if (driving === 'preview') return;
      driving = 'editor';
      const srcRange = scroller.scrollHeight - scroller.clientHeight;
      const dstRange = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop =
        srcRange > 0 && dstRange > 0 ? (scroller.scrollTop / srcRange) * dstRange : 0;
      requestAnimationFrame(() => {
        driving = null;
      });
    };

    const syncPreviewToEditor = (): void => {
      if (driving === 'editor') return;
      driving = 'preview';
      const srcRange = pane.scrollHeight - pane.clientHeight;
      const dstRange = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop =
        srcRange > 0 && dstRange > 0 ? (pane.scrollTop / srcRange) * dstRange : 0;
      requestAnimationFrame(() => {
        driving = null;
      });
    };

    syncEditorToPreview();
    scroller.addEventListener('scroll', syncEditorToPreview, { passive: true });
    pane.addEventListener('scroll', syncPreviewToEditor, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', syncEditorToPreview);
      pane.removeEventListener('scroll', syncPreviewToEditor);
    };
  }, [editorView, html]);

  return (
    <>
      <style>{PREVIEW_STYLES}</style>
      <div
        ref={paneRef}
        data-testid="markdown-preview"
        className={isDark ? 'np-md-preview np-md-dark' : 'np-md-preview np-md-light'}
        style={{ fontSize }}
        // Safe: html is the output of sanitizeMarkdownHtml (DOMPurify + image policy).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
