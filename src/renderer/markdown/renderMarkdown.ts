/**
 * Markdown rendering — RENDERER, Lane B (Phase 6). PURE (no DOM, no IPC).
 *
 * Ports the UWP Markdown preview extension (MarkdownExtensionView + the bundled
 * MarkdownTextBlock) to a markdown-it pipeline. The UWP control renders GitHub-
 * flavored-ish markdown from the editor's live text; we mirror that with
 * markdown-it configured for a GFM-equivalent surface.
 *
 * markdown-it is pure JS (no Node built-ins) so it is PA-8-safe in the renderer.
 *
 * Configuration rationale:
 *   - `html: false`  — the editor's text is untrusted user content; we never pass
 *     raw HTML through to the preview DOM (XSS-safe by construction). The UWP
 *     MarkdownTextBlock likewise renders markdown structure, not arbitrary HTML.
 *   - `linkify: true` — bare URLs become links (GFM autolink parity; UWP autolinks).
 *   - `breaks: true`  — a single newline becomes a <br>, matching the UWP preview's
 *     soft-break rendering of plain notes.
 *   - `typographer: false` — no smartquote/dash substitution; the preview shows the
 *     author's exact punctuation.
 *
 * The caller (MarkdownPreview component) owns turning the returned HTML string into
 * DOM and theming it; this module is a pure text→HTML transform so it is unit-testable.
 */

import MarkdownIt from 'markdown-it';

/**
 * The `.md` family — file extensions for which the preview toggle (Alt+P) is
 * offered, matching the UWP markdown extension's activation set. Lower-cased,
 * leading dot included.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn']);

/** Lazily-constructed shared instance (config is immutable, so one is enough). */
let md: MarkdownIt | null = null;

function getRenderer(): MarkdownIt {
  if (md === null) {
    md = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
      typographer: false,
    });
  }
  return md;
}

/**
 * True when `filePath` is a markdown-family file (preview toggle is offered).
 * An untitled buffer (null path) is NOT markdown by extension. Comparison is
 * case-insensitive and looks only at the final extension.
 */
export function isMarkdownPath(filePath: string | null): boolean {
  if (!filePath) return false;
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = filePath.slice(lastDot).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

/**
 * Render '\n'-normalized shadow-buffer markdown text to an HTML string. Pure and
 * deterministic. The input is the editor's exact text; output is safe HTML
 * (html:false means no raw-HTML passthrough).
 */
export function renderMarkdown(text: string): string {
  return getRenderer().render(text);
}
