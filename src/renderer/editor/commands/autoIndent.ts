/**
 * Enter / Shift+Enter with auto-indentation — RENDERER, Lane B.
 *
 * Ports UWP TextEditorCore.EnterWithAutoIndentation onto the '\n' shadow buffer.
 * On Enter (and Shift+Enter, which UWP maps to the same behavior), insert a
 * newline followed by the LEADING whitespace (spaces/tabs) of the text that
 * precedes the caret on the current line:
 *
 *   leadingSpacesAndTabs = leading run of [ \t] in currentLine.slice(0, caretColumn)
 *
 * Any active selection is replaced first (CM6 replaceSelection handles that), so
 * the inserted newline collapses the selection just like the UWP SetText path.
 *
 * One transaction = one undo step.
 */

import type { StateCommand } from '@codemirror/state';

/** Leading run of spaces/tabs in `text` (UWP String.LeadingSpacesAndTabs). */
function leadingSpacesAndTabs(text: string): string {
  let i = 0;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return text.slice(0, i);
}

/**
 * Insert '\n' + the current line's leading whitespace (measured up to the caret
 * column, matching UWP `Substring(0, startColumnIndex - 1)`), then collapse the
 * caret to the end of the inserted text.
 */
export const enterWithAutoIndent: StateCommand = ({ state, dispatch }): boolean => {
  const range = state.selection.main;
  // Use the selection's start line/column to mirror UWP, which reads the caret
  // (collapsed) or the selection start before replacing.
  const line = state.doc.lineAt(range.from);
  const beforeCaret = state.sliceDoc(line.from, range.from);
  const indent = leadingSpacesAndTabs(beforeCaret);

  dispatch(
    state.update(state.replaceSelection('\n' + indent), {
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
};
