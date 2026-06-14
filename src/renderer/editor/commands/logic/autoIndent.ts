/**
 * Pure auto-indent logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/autoIndent.ts for Monaco reuse (T2 → T3).
 */

/** Leading run of spaces/tabs in `text` (UWP String.LeadingSpacesAndTabs). */
export function leadingSpacesAndTabs(text: string): string {
  let i = 0;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text.slice(0, i);
}

/**
 * Compute the text to insert for Enter-with-auto-indent.
 *
 * @param docText   Full document text (LF-normalised).
 * @param selFrom   Start offset of the current selection (or caret position).
 * @returns         The string to insert at `selFrom` (always `'\n' + indent`).
 */
export function autoIndentInsert(docText: string, selFrom: number): string {
  // Find the start of the current line.
  const lineStart = docText.lastIndexOf('\n', selFrom - 1) + 1;
  const beforeCaret = docText.slice(lineStart, selFrom);
  const indent = leadingSpacesAndTabs(beforeCaret);
  return '\n' + indent;
}
