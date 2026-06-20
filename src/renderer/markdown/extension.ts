/**
 * Markdown file-extension detection — RENDERER. Pure, no DOM/IPC.
 *
 * Extracted from the former renderMarkdown.ts so consumers of the preview-toggle
 * test (Alt+P availability) don't drag in the markdown rendering pipeline.
 * The pipeline itself now lives in Rust (window.notepads.markdown.render).
 */

/**
 * The `.md` family — file extensions for which the preview toggle (Alt+P) is
 * offered, matching the UWP markdown extension's activation set. Lower-cased,
 * leading dot included.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn']);

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
