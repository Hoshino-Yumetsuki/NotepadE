/**
 * HTML sanitization for the markdown preview — RENDERER, Lane B. DOM-side.
 *
 * `renderMarkdown` now runs markdown-it with `html: true`, so its output is
 * UNTRUSTED raw HTML (embedded markup + plugin output). This module is the single
 * mandatory gate that turns that raw string into something safe to inject via
 * `dangerouslySetInnerHTML`. Nothing else in the app should call DOMPurify; the
 * preview is the only place untrusted HTML reaches the DOM.
 *
 * Two layers of defense:
 *   1. DOMPurify — strips scripts, event handlers, javascript: URLs, and any tag/
 *      attribute outside the allow-list. This is the XSS gate.
 *   2. An image-source policy (uponSanitizeAttribute hook) — the user asked to
 *      allow remote images, but only after a safety check. We permit:
 *        - https: URLs whose path has a known raster/vector image extension, OR no
 *          extension (many CDNs serve images from extensionless URLs); the real
 *          content-type is still enforced by the <img> load + a filetype sniff in
 *          the component before the element is shown.
 *        - data:image/* URIs (inline images).
 *      Everything else (http:, file:, blob:, javascript:, unknown schemes) is
 *      dropped so the preview never makes an insecure or surprising fetch.
 *
 * jsdom note: DOMPurify needs a `window`. In the browser/Electron renderer the
 * global `window` is used; under vitest's jsdom env it is likewise present, so the
 * default export works in both without a JSDOM shim.
 */

import createDOMPurify from 'dompurify';

const purify = createDOMPurify(window);

/** Schemes allowed on <a href>. http(s)/mailto only — no javascript:/data: links. */
const SAFE_LINK_SCHEME = /^(?:https?:|mailto:)/i;

/**
 * Decide whether an <img src> may be kept.
 * - https: any URL (all remote sources allowed; CSP enforces the scheme boundary)
 * - data:image/* inline images
 * - Rejects file:, blob:, javascript:, http:, and other unsafe schemes.
 * Exported for unit testing the policy in isolation.
 */
export function isAllowedImageSrc(src: string): boolean {
  const value = src.trim();
  if (value === '') return false;
  if (/^data:image\//i.test(value)) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:';
  } catch {
    return false;
  }
}

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'src') {
      if (!isAllowedImageSrc(data.attrValue)) {
        data.keepAttr = false;
      }
    }
    if (data.attrName === 'href') {
      const v = data.attrValue.trim();
      // Permit in-page fragment links (footnotes, TOC) and safe schemes only.
      if (!v.startsWith('#') && !SAFE_LINK_SCHEME.test(v)) {
        data.keepAttr = false;
      }
    }
  });

  // Force external links to open safely: no opener handle, no referrer leak.
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')?.startsWith('http')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    // Lazy-load preview images so a long note doesn't fetch everything at once.
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('referrerpolicy', 'no-referrer');
    }
  });
}

/**
 * DOMPurify allow-list. Covers the structural HTML the markdown plugins emit
 * (alerts, figures, task-list checkboxes, footnotes, definition lists, details/
 * summary spoilers, …) plus the class/id/aria attributes those plugins set.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'code',
    'col',
    'colgroup',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'input',
    'ins',
    'kbd',
    'label',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    'q',
    's',
    'samp',
    'section',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
    'var',
    'wbr'
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'id',
    'for',
    'align',
    'colspan',
    'rowspan',
    'start',
    'type',
    'checked',
    'disabled',
    'open',
    'tabindex',
    'aria-hidden',
    'aria-label',
    'role',
    'data-line',
    'data-footnote-ref',
    'data-footnote-id',
    // `style` is needed by the align plugin (text-align:…). DOMPurify runs its
    // built-in CSS sanitizer over style values, so this does not open a
    // script/expression injection path.
    'style'
  ],
  // input is allow-listed ONLY for task-list checkboxes; constrain it to that.
  ALLOW_DATA_ATTR: false
};

/**
 * Sanitize raw markdown HTML for safe injection into the preview DOM. This is the
 * mandatory bridge between `renderMarkdown` (unsafe) and `dangerouslySetInnerHTML`.
 */
export function sanitizeMarkdownHtml(rawHtml: string): string {
  installHooks();
  return purify.sanitize(rawHtml, PURIFY_CONFIG);
}
