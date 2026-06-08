/**
 * Markdown rendering — RENDERER, Lane B (Phase 6). PURE (no DOM, no IPC).
 *
 * Ports the UWP Markdown preview extension (MarkdownExtensionView + the bundled
 * MarkdownTextBlock) to a markdown-it pipeline, then EXTENDS it with a curated set
 * of plugins from the mdit-plugins collection (https://mdit-plugins.github.io/) so
 * the preview renders GitHub-flavored notes (task lists, footnotes, alerts, marks,
 * sub/sup, figures, containers, emoji, …) the way authors expect.
 *
 * SAFETY MODEL — read before changing `html`:
 *   This module now runs markdown-it with `html: true`, so raw HTML in the source
 *   AND the HTML emitted by the plugins flows through verbatim. That means the
 *   string returned here is UNTRUSTED and MUST NOT be injected into the DOM as-is.
 *   Sanitization is a SEPARATE, MANDATORY step that lives in the DOM layer
 *   (`sanitizeMarkdownHtml` in ./sanitizeHtml, applied by MarkdownPreview before
 *   dangerouslySetInnerHTML). Keeping the transform pure here lets it stay
 *   unit-testable; keeping DOMPurify out of here keeps this module DOM-free.
 *
 *   renderMarkdown(text)            -> raw, UNSAFE html (this file)
 *   sanitizeMarkdownHtml(rawHtml)   -> safe html for the DOM (./sanitizeHtml)
 *   MarkdownPreview                 -> composes the two, injects the safe result
 *
 * Configuration rationale:
 *   - `html: true`   — raw HTML is allowed through the parser so notes can embed
 *     markup; the DOMPurify pass downstream is what makes it safe. (Previously
 *     `html:false` made this file XSS-safe by construction; that guarantee now
 *     lives in sanitizeMarkdownHtml instead.)
 *   - `linkify: true`— bare URLs become links (GFM autolink parity; UWP autolinks).
 *   - `breaks: true` — a single newline becomes a <br>, matching the UWP preview's
 *     soft-break rendering of plain notes.
 *   - `typographer: false` — no smartquote/dash substitution; the preview shows the
 *     author's exact punctuation.
 *
 * Every plugin is pure JS (no Node built-ins) so the pipeline stays PA-8-safe in
 * the renderer. Node-only mdit-plugins (include, snippet) are deliberately excluded.
 */

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { tasklist } from '@mdit/plugin-tasklist';
import { footnote } from '@mdit/plugin-footnote';
import { sub } from '@mdit/plugin-sub';
import { sup } from '@mdit/plugin-sup';
import { mark } from '@mdit/plugin-mark';
import { ins } from '@mdit/plugin-ins';
import { abbr } from '@mdit/plugin-abbr';
import { dl } from '@mdit/plugin-dl';
import { alert } from '@mdit/plugin-alert';
import { attrs } from '@mdit/plugin-attrs';
import { figure } from '@mdit/plugin-figure';
import { spoiler } from '@mdit/plugin-spoiler';
import { align } from '@mdit/plugin-align';
import { container } from '@mdit/plugin-container';
import { fullEmoji } from '@mdit/plugin-emoji';

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
      html: true,
      linkify: true,
      breaks: true,
      typographer: false,
      highlight(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          } catch {
            // fall through to plain
          }
        }
        return hljs.highlightAuto(code).value;
      },
    });
    // Inline / span extensions (GFM-ish): ==mark==, ++ins++, ~sub~, ^sup^,
    // >!spoiler!<, abbreviations, and :emoji: shortcodes.
    md.use(mark).use(ins).use(sub).use(sup).use(spoiler).use(abbr).use(fullEmoji);
    // Block extensions: task lists, footnotes, definition lists, GitHub-style
    // alert/admonition blocks, figures-with-captions, custom ::: containers, and
    // alignment blocks. attrs is registered LAST so `{.class #id}` annotations can
    // attach to tokens produced by the other block rules.
    md.use(tasklist, { disabled: false })
      .use(footnote)
      .use(dl)
      .use(alert)
      .use(figure)
      .use(container, { name: 'info' })
      .use(align)
      .use(attrs);
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
 * deterministic. The output is UNTRUSTED raw HTML (html:true + plugin output) and
 * MUST be passed through `sanitizeMarkdownHtml` before it touches the DOM.
 */
export function renderMarkdown(text: string): string {
  return getRenderer().render(text);
}
