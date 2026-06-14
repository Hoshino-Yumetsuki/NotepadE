/**
 * Pure join-lines logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/joinLines.ts for Monaco reuse (T2 → T3).
 */

export interface JoinResult {
  /** The replacement text for the range [from, to). */
  joined: string;
  /** Start offset of the region to replace. */
  from: number;
  /** End offset of the region to replace (exclusive). */
  to: number;
  /** New selection after the replacement. */
  newSel: { anchor: number; head: number };
  /** false when the command is a no-op (single line or already joined). */
  changed: boolean;
}

/**
 * Compute join-lines for a plain text document.
 *
 * @param docText   Full document text (LF-normalised).
 * @param selFrom   Selection start offset.
 * @param selTo     Selection end offset.
 * @param selAnchor Raw anchor (may be > head for reverse selections).
 * @param selHead   Raw head.
 */
export function joinLogic(
  docText: string,
  selFrom: number,
  selTo: number,
  selAnchor: number,
  selHead: number
): JoinResult {
  // Find start of the first spanned line.
  const firstLineStart = docText.lastIndexOf('\n', selFrom - 1) + 1;
  // Find end of the last spanned line.
  const lastNL = docText.indexOf('\n', selTo);
  const lastLineEnd = lastNL === -1 ? docText.length : lastNL;

  // Collect all line texts between firstLineStart and lastLineEnd.
  const region = docText.slice(firstLineStart, lastLineEnd);
  const parts = region.split('\n');

  // No-op when only one line is spanned.
  if (parts.length <= 1) {
    return {
      joined: region,
      from: firstLineStart,
      to: lastLineEnd,
      newSel: { anchor: selAnchor, head: selHead },
      changed: false
    };
  }

  const joined = parts.join(' ');

  // No-op when the result is identical (already joined).
  if (joined === region) {
    return {
      joined,
      from: firstLineStart,
      to: lastLineEnd,
      newSel: { anchor: selAnchor, head: selHead },
      changed: false
    };
  }

  const clamp = (pos: number): number =>
    pos > firstLineStart + joined.length ? firstLineStart + joined.length : pos;

  return {
    joined,
    from: firstLineStart,
    to: lastLineEnd,
    newSel: { anchor: clamp(selAnchor), head: clamp(selHead) },
    changed: true
  };
}
