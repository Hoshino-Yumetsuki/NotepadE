/**
 * Pure move-words logic — editor-agnostic, zero @codemirror imports.
 *
 * Extracted from commands/moveWords.ts for Monaco reuse (T2 → T3).
 */

export function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Expand [selStart, selEnd) to whole-word boundaries.
 * Mirrors UWP GetMovingWordsIndexData.
 */
export function movingWordSpan(
  doc: string,
  selStart: number,
  selEnd: number
): { start: number; end: number } {
  let startIndex = selStart;
  if (selEnd === selStart || (selStart < doc.length && isLetterOrDigit(doc[selStart]))) {
    while (startIndex > 0) {
      startIndex--;
      if (!isLetterOrDigit(doc[startIndex])) {
        startIndex++;
        break;
      }
    }
  }

  const clampedEnd = selEnd > doc.length ? doc.length : selEnd;
  let endIndex = clampedEnd;
  if (selEnd === selStart || (clampedEnd > 0 && isLetterOrDigit(doc[clampedEnd - 1]))) {
    while (endIndex < doc.length) {
      endIndex++;
      if (!isLetterOrDigit(doc[endIndex - 1])) {
        endIndex--;
        break;
      }
    }
  }
  return { start: startIndex, end: endIndex };
}

/**
 * Swap [leftStart,leftEnd) with [rightStart,rightEnd) in `doc`.
 * Returns the replacement text and new selection offsets. Mirrors UWP MoveWords.
 */
export function swapSpans(
  doc: string,
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
  selStart: number,
  selEnd: number,
  moveAmount: number
): { text: string; from: number; to: number; anchor: number; head: number } {
  const leftWords = doc.slice(leftStart, leftEnd);
  const rightWords = doc.slice(rightStart, rightEnd);
  const middle = doc.slice(leftEnd, rightStart);
  const replacement = rightWords + middle + leftWords;
  return {
    text: replacement,
    from: leftStart,
    to: rightEnd,
    anchor: selStart + moveAmount,
    head: selEnd + moveAmount
  };
}

export interface MoveWordResult {
  /** Replacement text for region [from, to). */
  text: string;
  from: number;
  to: number;
  newAnchor: number;
  newHead: number;
  changed: boolean;
}

/** Compute move-word-left for a plain text document. */
export function moveWordLeftLogic(doc: string, selFrom: number, selTo: number): MoveWordResult {
  const noop: MoveWordResult = {
    text: '',
    from: 0,
    to: 0,
    newAnchor: selFrom,
    newHead: selTo,
    changed: false
  };
  if (selFrom === 0) return noop;

  const moving = movingWordSpan(doc, selFrom, selTo);
  const startIndex = moving.start;
  const endIndex = moving.end;
  if (startIndex <= 0 || startIndex >= endIndex) return noop;

  let replacedEnd = startIndex;
  while (replacedEnd > 0) {
    replacedEnd--;
    if (isLetterOrDigit(doc[replacedEnd])) {
      replacedEnd++;
      break;
    }
  }
  let replacedStart = replacedEnd;
  while (replacedStart > 0) {
    replacedStart--;
    if (!isLetterOrDigit(doc[replacedStart])) {
      replacedStart++;
      break;
    }
  }

  const moveAmount = replacedStart - startIndex;
  const swap = swapSpans(
    doc,
    replacedStart,
    replacedEnd,
    startIndex,
    endIndex,
    selFrom,
    selTo,
    moveAmount
  );
  return {
    text: swap.text,
    from: swap.from,
    to: swap.to,
    newAnchor: Math.max(0, swap.anchor),
    newHead: Math.max(0, swap.head),
    changed: true
  };
}

/** Compute move-word-right for a plain text document. */
export function moveWordRightLogic(doc: string, selFrom: number, selTo: number): MoveWordResult {
  const noop: MoveWordResult = {
    text: '',
    from: 0,
    to: 0,
    newAnchor: selFrom,
    newHead: selTo,
    changed: false
  };
  if (selTo >= doc.length) return noop;

  const moving = movingWordSpan(doc, selFrom, selTo);
  const startIndex = moving.start;
  const endIndex = moving.end;
  if (endIndex <= startIndex || endIndex >= doc.length) return noop;

  let replacedStart = endIndex;
  for (; replacedStart < doc.length; replacedStart++) {
    if (isLetterOrDigit(doc[replacedStart])) break;
  }
  let replacedEnd = replacedStart;
  for (; replacedEnd < doc.length; replacedEnd++) {
    if (!isLetterOrDigit(doc[replacedEnd])) break;
  }

  const moveAmount = replacedEnd - endIndex;
  const swap = swapSpans(
    doc,
    startIndex,
    endIndex,
    replacedStart,
    replacedEnd,
    selFrom,
    selTo,
    moveAmount
  );
  return {
    text: swap.text,
    from: swap.from,
    to: swap.to,
    newAnchor: swap.anchor,
    newHead: swap.head,
    changed: true
  };
}
