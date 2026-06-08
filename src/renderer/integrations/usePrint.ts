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
 */
const PRINT_CSS = `
#${PRINT_HOST_ID} { display: none; }
@media print {
  body > *:not(#${PRINT_HOST_ID}) { display: none !important; }
  #${PRINT_HOST_ID} { display: block !important; }
  .np-print-doc { white-space: pre-wrap; word-break: break-word;
    font-family: Consolas, "Courier New", monospace; font-size: 12pt; }
  .np-print-doc + .np-print-doc { page-break-before: always; }
  .np-print-title { font-weight: bold; font-size: 13pt; margin: 0 0 8px;
    font-family: Segoe UI, sans-serif; }
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
        `<div class="np-print-title">${escapeHtml(doc.title)}</div>` +
        `<div>${escapeHtml(doc.text)}</div>` +
        `</section>`
    )
    .join('');
}

/**
 * Lay out `docs` into the print host and ask MAIN to print, clearing the host
 * afterward. Exported (not just via the hook) so non-React callers/tests can use
 * it. Returns the bridge Result; a user cancel resolves ok (MAIN maps it).
 */
export async function printDocuments(
  docs: PrintDocument[]
): Promise<{ ok: boolean; error?: string }> {
  if (docs.length === 0) return { ok: true };
  ensurePrintStyle();
  const host = ensurePrintHost();
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
  printCurrent: (doc: PrintDocument) => Promise<void>;
  /** Print every open document, one per page (Ctrl+Shift+P). */
  printAll: (docs: PrintDocument[]) => Promise<void>;
}

/**
 * usePrint — returns stable print actions. The caller supplies the document(s) at
 * call time (it owns the tab text), keeping this hook free of editor coupling.
 *
 * WIRING (App.tsx integration pass — lane-a):
 *   const print = usePrint();
 *   // Ctrl+P:        print.printCurrent({ title, text: activeShadowText })
 *   // Ctrl+Shift+P:  print.printAll(allTabs.map(t => ({ title, text })))
 */
export function usePrint(): PrintActions {
  const printCurrent = useCallback(async (doc: PrintDocument): Promise<void> => {
    await printDocuments([doc]);
  }, []);
  const printAll = useCallback(async (docs: PrintDocument[]): Promise<void> => {
    await printDocuments(docs);
  }, []);
  return { printCurrent, printAll };
}
