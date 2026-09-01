/** Pure whitespace trimming used by smart-copy. */

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
