/**
 * Pure duplicate-line/selection logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/duplicate.ts for Monaco reuse (T2 → T3).
 */

export interface DuplicateResult {
  /** Text to insert. */
  insert: string;
  /** Offset at which to insert (no deletion). */
  insertAt: number;
  /** New selection after the insert. */
  newSel: { anchor: number; head: number };
}

/**
 * Compute the duplicate operation for a plain text document.
 *
 * @param docText   Full document text (LF-normalised).
 * @param selFrom   Selection start (≤ selTo).
 * @param selTo     Selection end (= selFrom for collapsed caret).
 * @returns         Descriptor the caller applies as an edit.
 */
export function duplicateLogic(docText: string, selFrom: number, selTo: number): DuplicateResult {
  if (selFrom === selTo) {
    // Collapsed caret: duplicate the current line below.
    const lineStart = docText.lastIndexOf('\n', selFrom - 1) + 1;
    const lineEnd = docText.indexOf('\n', selFrom);
    const lineEndOffset = lineEnd === -1 ? docText.length : lineEnd;
    const lineText = docText.slice(lineStart, lineEndOffset);
    const column = selFrom - lineStart;
    const insert = '\n' + lineText;
    const newHead = lineEndOffset + 1 + column;
    return { insert, insertAt: lineEndOffset, newSel: { anchor: newHead, head: newHead } };
  }

  // Non-empty selection: duplicate immediately after, select the copy.
  const text = docText.slice(selFrom, selTo);
  return {
    insert: text,
    insertAt: selTo,
    newSel: { anchor: selTo, head: selTo + text.length }
  };
}
