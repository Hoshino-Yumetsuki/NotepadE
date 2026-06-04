import { useMemo } from 'react';
import { renderMarkdown } from './renderMarkdown';

/**
 * MarkdownPreview — RENDERER, Lane B (Phase 6). Self-contained, pure-presentational
 * markdown preview pane. Ports the UWP MarkdownExtensionView: renders the editor's
 * live '\n' text as GFM-equivalent HTML (see renderMarkdown.ts) in a scrollable
 * pane meant to sit SIDE-BY-SIDE with the editor (Alt+P toggles it on for .md files).
 *
 * Safety: `renderMarkdown` runs markdown-it with html:false, so the produced HTML
 * contains NO raw user HTML (every `<...>` in the source is escaped). The string is
 * therefore safe to inject via dangerouslySetInnerHTML — there is no XSS surface.
 *
 * Styling follows the codebase convention (inline styles + a scoped <style> block,
 * no external .css imports). The scoped block targets only `.np-md-preview` element
 * descendants so it cannot leak into the rest of the app.
 *
 * MOUNT API (for the App.tsx integration pass — lane-a):
 *   <MarkdownPreview text={shadowText} isDark={resolvedTheme === 'dark'} />
 * Render it beside the editor host (50/50 split) when the active tab's
 * viewMode.preview is true. The component owns its own scroll + theming.
 */

export interface MarkdownPreviewProps {
  /** The editor's live '\n'-normalized shadow text to render. */
  text: string;
  /** Dark-theme flag — toggles the preview's text/link/code palette. */
  isDark?: boolean;
  /** Optional body font size in px (defaults to 14, the editor default). */
  fontSize?: number;
}

/** Scoped element styling for the rendered markdown (headings, code, quotes, etc.). */
const PREVIEW_STYLES = `
.np-md-preview { padding: 12px 18px; overflow: auto; height: 100%; box-sizing: border-box;
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
.np-md-dark { color: #E6E6E6; }
.np-md-dark a { color: #4FA3FF; }
.np-md-light { color: #1A1A1A; }
.np-md-light a { color: #0067C0; }
`;

export function MarkdownPreview({
  text,
  isDark = false,
  fontSize = 14,
}: MarkdownPreviewProps): JSX.Element {
  // Re-render only when the source text changes (markdown-it is the only cost).
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <>
      <style>{PREVIEW_STYLES}</style>
      <div
        data-testid="markdown-preview"
        className={isDark ? 'np-md-preview np-md-dark' : 'np-md-preview np-md-light'}
        style={{ fontSize }}
        // Safe: renderMarkdown uses html:false, so no raw user HTML is present.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
