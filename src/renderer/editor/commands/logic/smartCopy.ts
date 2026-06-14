/**
 * Pure smart-copy trim logic — editor-agnostic, zero @codemirror imports.
 *
 * Self-contained as of the Monaco migration (T6): the pure trim computation
 * lives here outright (no longer re-exported from the deleted CM6 `../smartCopy`).
 *
 * UWP trim rule (TextEditorCore.SmartlyTrimTextSelection):
 *   - whitespace chars are ' ', '\t', and the line-break char.
 *   - if the selection is ALL whitespace → leave it untouched (copy verbatim).
 *   - leading whitespace is trimmed, but the trim START is pulled back to AFTER
 *     the LAST line break within the leading-whitespace run (so leading spaces on
 *     the first content line are kept; whole blank leading lines are dropped).
 *   - trailing whitespace (spaces/tabs/breaks) is trimmed.
 */

const WS = new Set([' ', '\t', '\n']);

function isAllWhitespace(text: string): boolean {
  for (const ch of text) {
    if (!WS.has(ch)) return false;
  }
  return text.length > 0;
}

/**
 * Compute the Smart-Copy trimmed form of `selectedText`. Pure; shadow-buffer
 * '\n' line breaks. Returns the input unchanged when it is all whitespace.
 */
export function smartTrimSelection(selectedText: string): string {
  if (selectedText.length === 0) return selectedText;
  if (isAllWhitespace(selectedText)) return selectedText;

  // Leading: find first non-whitespace; pull the start back to after the last
  // line break that precedes it (UWP lastLineBreakOffset logic).
  let firstContent = 0;
  while (firstContent < selectedText.length && WS.has(selectedText[firstContent])) firstContent++;
  const leading = selectedText.slice(0, firstContent);
  const lastBreak = leading.lastIndexOf('\n');
  const startOffset = lastBreak === -1 ? 0 : lastBreak + 1;

  // Trailing: trim spaces/tabs/breaks from the end.
  let lastContent = selectedText.length;
  while (lastContent > startOffset && WS.has(selectedText[lastContent - 1])) lastContent--;

  return selectedText.slice(startOffset, lastContent);
}
