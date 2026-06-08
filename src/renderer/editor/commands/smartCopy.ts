/**
 * Smart Copy = whitespace-trim-on-copy (RENDERER, Lane B).
 *
 * APPROVED divergence #6 (docs/plan/11): with Smart Copy ON, COPY places the
 * whitespace-trimmed selection on the clipboard. CUT is never trimmed. Default
 * off. This replicates UWP TextEditorCore.SmartlyTrimTextSelection (which
 * adjusts the selection range before the copy) — we compute the trimmed STRING
 * directly and override the clipboard payload, which is the observable result.
 *
 * UWP trim rule (SmartlyTrimTextSelection):
 *   - whitespace chars are ' ', '\t', and the line-break char.
 *   - if the selection is ALL whitespace → leave it untouched (copy verbatim).
 *   - leading whitespace is trimmed, but the trim START is pulled back to AFTER
 *     the LAST line break within the leading-whitespace run (so leading spaces on
 *     the first content line are kept; whole blank leading lines are dropped).
 *   - trailing whitespace (spaces/tabs/breaks) is trimmed.
 */

import { EditorView } from '@codemirror/view';
import { editorSettings } from '../editorSettings';

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

/**
 * DOM extension that intercepts the editor's `copy` event. When Smart Copy is
 * enabled (per the `editorSettings` facet) and there is a non-empty selection,
 * it writes the trimmed text to the clipboard instead of the raw selection.
 * `cut` is intentionally NOT handled, so cut is never trimmed.
 */
export const smartCopyHandler = EditorView.domEventHandlers({
  copy(event, view) {
    if (!view.state.facet(editorSettings).smartCopy) return false;
    const range = view.state.selection.main;
    if (range.empty) return false;

    const selected = view.state.sliceDoc(range.from, range.to);
    const trimmed = smartTrimSelection(selected);
    if (trimmed === selected) return false; // nothing to change

    event.clipboardData?.setData('text/plain', trimmed);
    event.preventDefault();
    return true;
  }
});
