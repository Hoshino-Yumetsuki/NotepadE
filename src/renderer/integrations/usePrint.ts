/**
 * Print integration — RENDERER, Lane B (Phase 6).
 *
 * Ports the UWP Print path (Controls/Print/PrintArgs + PrintPageFormat): print the
 * CURRENT document (Ctrl+P) or ALL open documents (Ctrl+Shift+P). UWP renders a
 * dedicated print page; the web port mirrors that by laying out a print-only DOM
 * surface, then asking MAIN to drive the OS print flow via
 * `window.notepads.shell.print()` (which calls webContents.print()).
 *
 * Because MAIN prints the focused window's webContents, the renderer must make the
 * visible-to-print DOM be exactly the document(s) to print. We do this with a
 * dedicated print host element + a print-only stylesheet that hides the live app
 * chrome under `@media print`. The host is populated right before the print call
 * and cleared after it resolves, so it never affects the on-screen UI.
 *
 * PA-8: pure renderer/DOM + the typed bridge. No fs/path/child_process, no raw IPC.
 */

import { useCallback } from 'react';
import { escapeHtml } from './escapeHtml';
import { DEFAULT_FONT_FAMILY, resolveFontFamily } from '../editor/fontFamily';

/** A single document to print: a display title + its '\n'-normalized text. */
export interface PrintDocument {
  title: string;
  text: string;
}

const PRINT_HOST_ID = 'np-print-host';
const PRINT_STYLE_ID = 'np-print-style';

/**
 * Print-only stylesheet: on screen the host is hidden; when printing, ONLY the
 * host is shown (the live app root is hidden). The app root is matched by
 * `#root` (the renderer mount, see index.html) — everything inside it is omitted
 * from the printout so the page shows just the document text.
 *
 * `@page { margin: 0 }` drops the browser's print header/footer (date, document
 * title, the localhost dev URL, and page numbers) — Chromium renders those into
 * the page-margin box, so removing the margin removes the chrome. Readable insets
 * are restored as padding on the printed content instead. The body font is taken
 * from the `--np-print-font` custom property (set per call to the editor's
 * resolved family) so a CJK locale prints in the system font, not 宋体.
 */
const PRINT_CSS = `
#${PRINT_HOST_ID} { display: none; }
@page { margin: 0; }
@media print {
  body > *:not(#${PRINT_HOST_ID}) { display: none !important; }
  #${PRINT_HOST_ID} { display: block !important; }
  .np-print-doc { white-space: pre-wrap; word-break: break-word;
    font-family: var(--np-print-font, ${DEFAULT_FONT_FAMILY}); font-size: 12pt;
    padding: 12mm; }
  .np-print-doc + .np-print-doc { page-break-before: always; }
}
`;

/** Ensure the print stylesheet is present (idempotent). */
function ensurePrintStyle(): void {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);
}

/** Get-or-create the off-screen print host appended to <body>. */
function ensurePrintHost(): HTMLElement {
  let host = document.getElementById(PRINT_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = PRINT_HOST_ID;
    document.body.appendChild(host);
  }
  return host;
}

/** Build the print host content for one or more documents (escaped — no XSS). */
function populatePrintHost(host: HTMLElement, docs: PrintDocument[]): void {
  host.innerHTML = docs
    .map(
      (doc) =>
        `<section class="np-print-doc">` +
        `<div>${escapeHtml(doc.text)}</div>` +
        `</section>`
    )
    .join('');
}

/**
 * Lay out `docs` into the print host and ask MAIN to print, clearing the host
 * afterward. Exported (not just via the hook) so non-React callers/tests can use
 * it. Returns the bridge Result; a user cancel resolves ok (MAIN maps it).
 *
 * `fontFamily` is the raw editor font setting ('' = system default); it is
 * resolved to the same CSS family the editor uses and applied to the printed
 * text, so the printout matches the on-screen font instead of falling back to a
 * monospace/宋体 default.
 */
export async function printDocuments(
  docs: PrintDocument[],
  fontFamily = ''
): Promise<{ ok: boolean; error?: string }> {
  if (docs.length === 0) return { ok: true };
  ensurePrintStyle();
  const host = ensurePrintHost();
  host.style.setProperty('--np-print-font', resolveFontFamily(fontFamily));
  populatePrintHost(host, docs);
  try {
    const result = await window.notepads?.shell.print();
    return result ?? { ok: false, error: 'Bridge unavailable' };
  } finally {
    host.innerHTML = '';
  }
}

/** Bound print actions for the active tab (current) and all tabs. */
export interface PrintActions {
  /** Print the single current document (Ctrl+P). */
  printCurrent: (doc: PrintDocument, fontFamily?: string) => Promise<void>;
  /** Print every open document, one per page (Ctrl+Shift+P). */
  printAll: (docs: PrintDocument[], fontFamily?: string) => Promise<void>;
}

/**
 * usePrint — returns stable print actions. The caller supplies the document(s)
 * and the editor font setting at call time (it owns the tab text + settings),
 * keeping this hook free of editor/settings coupling.
 *
 * WIRING (App.tsx integration pass — lane-a):
 *   const print = usePrint();
 *   // Ctrl+P:        print.printCurrent({ title, text }, settings.editorFontFamily)
 *   // Ctrl+Shift+P:  print.printAll(allTabs, settings.editorFontFamily)
 */
export function usePrint(): PrintActions {
  const printCurrent = useCallback(
    async (doc: PrintDocument, fontFamily = ''): Promise<void> => {
      await printDocuments([doc], fontFamily);
    },
    []
  );
  const printAll = useCallback(
    async (docs: PrintDocument[], fontFamily = ''): Promise<void> => {
      await printDocuments(docs, fontFamily);
    },
    []
  );
  return { printCurrent, printAll };
}
