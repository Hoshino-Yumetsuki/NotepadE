/**
 * Pure move-lines logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/moveLines.ts for Monaco reuse (T2 → T3).
 */

export interface MoveLinesResult {
  /** Replacement text for the region [from, to). */
  insert: string;
  from: number;
  to: number;
  /** New selection anchor/head after the move. */
  newAnchor: number;
  newHead: number;
  /** false when command is a no-op (already at edge). */
  changed: boolean;
}

/**
 * Compute move-lines-up/down for a plain text document.
 *
 * @param docText   Full document text (LF-normalised).
 * @param selFrom   Selection start offset.
 * @param selTo     Selection end offset.
 * @param selAnchor Raw anchor.
 * @param selHead   Raw head.
 * @param dir       'up' | 'down'
 */
export function moveLinesLogic(
  docText: string,
  selFrom: number,
  selTo: number,
  selAnchor: number,
  selHead: number,
  dir: 'up' | 'down'
): MoveLinesResult {
  // Split document into lines with their offsets.
  const lines: Array<{ text: string; from: number; to: number }> = [];
  let pos = 0;
  for (const raw of docText.split('\n')) {
    lines.push({ text: raw, from: pos, to: pos + raw.length });
    pos += raw.length + 1;
  }

  const startLineIdx = lines.findIndex((l) => l.from <= selFrom && selFrom <= l.to);
  const endLineIdx = lines.findIndex((l) => l.from <= selTo && selTo <= l.to);

  const noop: MoveLinesResult = {
    insert: docText,
    from: 0,
    to: docText.length,
    newAnchor: selAnchor,
    newHead: selHead,
    changed: false
  };

  if (dir === 'up') {
    if (startLineIdx === 0) return noop;
    const prev = lines[startLineIdx - 1];
    const startLine = lines[startLineIdx];
    const endLine = lines[endLineIdx];
    const block = docText.slice(startLine.from, endLine.to);
    const insert = block + '\n' + prev.text;
    const shift = prev.text.length + 1;
    return {
      insert,
      from: prev.from,
      to: endLine.to,
      newAnchor: selAnchor - shift,
      newHead: selHead - shift,
      changed: true
    };
  } else {
    if (endLineIdx === lines.length - 1) return noop;
    const next = lines[endLineIdx + 1];
    const startLine = lines[startLineIdx];
    const endLine = lines[endLineIdx];
    const block = docText.slice(startLine.from, endLine.to);
    const insert = next.text + '\n' + block;
    const shift = next.text.length + 1;
    return {
      insert,
      from: startLine.from,
      to: next.to,
      newAnchor: selAnchor + shift,
      newHead: selHead + shift,
      changed: true
    };
  }
}
