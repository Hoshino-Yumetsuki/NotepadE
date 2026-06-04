/**
 * Side-by-side diff MODEL — RENDERER, Lane B (Phase 6).
 *
 * Pure, view-agnostic port of the UWP `RichTextBlockDiffRenderer` shape
 * (E:\Projects\Notepads\src\Notepads\Controls\DiffViewer\RichTextBlockDiffRenderer.cs).
 * It turns two '\n'-normalized shadow-buffer texts (left = last-saved/original,
 * right = current/modified) into TWO row-aligned columns the `DiffViewer`
 * component renders with synced scroll.
 *
 * Parity with the UWP DiffPlex `SideBySideDiffBuilder`:
 *   - The two columns ALWAYS have the same number of rows (UWP `Zip` over
 *     OldText.Lines / NewText.Lines), so row N on the left aligns with row N on
 *     the right for a clean synced-scroll side-by-side view.
 *   - A row that exists only on one side is paired against an IMAGINARY (filler)
 *     row on the other side (UWP `ChangeType.Imaginary`). Filler rows render as a
 *     neutral gray placeholder and carry no text.
 *   - Per-row classification mirrors the UWP switch:
 *       Unchanged → no highlight,
 *       Inserted  → green   (UWP Colors.LightGreen),
 *       Deleted   → orange-red (UWP Colors.OrangeRed),
 *       Modified  → yellow, with CHARACTER-level sub-pieces so only the changed
 *                   spans inside the line are tinted (UWP ConstructModifiedParagraph).
 *
 * jsdiff (the `diff` package) emits a FLAT hunk list (added/removed/unchanged),
 * not DiffPlex's paired old/new line model, so this module reconstructs the
 * paired/aligned model from those hunks (see `buildDiffModel`).
 *
 * PA-8: pure data — no fs/path/child_process, no IPC, no DOM. Safe in renderer
 * and fully unit-testable.
 */

import { diffLines, diffChars } from 'diff';

/** Per-row change classification (mirrors DiffPlex ChangeType for our columns). */
export type DiffRowKind =
  | 'unchanged'
  | 'inserted'
  | 'deleted'
  | 'modified'
  | 'imaginary';

/** Per-piece classification inside a MODIFIED row (character-level sub-diff). */
export type DiffPieceKind = 'unchanged' | 'inserted' | 'deleted';

/** A character-level run within a modified line. */
export interface DiffPiece {
  text: string;
  kind: DiffPieceKind;
}

/** One rendered row in a single column. */
export interface DiffRow {
  kind: DiffRowKind;
  /** Full line text (empty for an imaginary filler row). */
  text: string;
  /**
   * Character-level sub-pieces — present ONLY for `modified` rows so the view can
   * tint just the changed spans (UWP per-Run highlight). For all other kinds this
   * is undefined and the whole row is painted with the row color.
   */
  pieces?: DiffPiece[];
}

/** The aligned two-column result. `left.length === right.length` always. */
export interface DiffModel {
  left: DiffRow[];
  right: DiffRow[];
}

/** An imaginary/filler row carries no text and renders as a neutral placeholder. */
function imaginaryRow(): DiffRow {
  return { kind: 'imaginary', text: '' };
}

/**
 * Split a hunk's `value` into its constituent lines WITHOUT the trailing newline
 * markers. jsdiff hunks include the '\n' terminators; a hunk that ends in '\n'
 * would otherwise yield a spurious trailing empty line. We treat the text as a
 * sequence of lines exactly as the editor's '\n' shadow buffer does.
 */
function splitLines(value: string): string[] {
  if (value === '') return [];
  const lines = value.split('\n');
  // A hunk value that ends with '\n' produces a trailing '' — drop it: that
  // newline is the line terminator, not a real empty line. (DiffPlex models a
  // file as N lines, not N+1.)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Character-level sub-diff of a single old/new line for the MODIFIED case. Mirrors
 * UWP `ConstructModifiedParagraph`, which walks DiffPlex sub-pieces and tints the
 * changed characters (deleted spans on the left column, inserted on the right).
 *
 * Returns the piece list for BOTH columns:
 *   - left  pieces keep `unchanged` + `deleted` spans (the old line),
 *   - right pieces keep `unchanged` + `inserted` spans (the new line).
 */
function charPieces(oldLine: string, newLine: string): {
  left: DiffPiece[];
  right: DiffPiece[];
} {
  const parts = diffChars(oldLine, newLine);
  const left: DiffPiece[] = [];
  const right: DiffPiece[] = [];
  for (const part of parts) {
    if (part.added) {
      right.push({ text: part.value, kind: 'inserted' });
    } else if (part.removed) {
      left.push({ text: part.value, kind: 'deleted' });
    } else {
      left.push({ text: part.value, kind: 'unchanged' });
      right.push({ text: part.value, kind: 'unchanged' });
    }
  }
  return { left, right };
}

/**
 * Emit aligned rows for a removed-run immediately followed by an added-run. The
 * overlapping lines (by index) are MODIFIED (char-level sub-diff, yellow); any
 * surplus removed lines become Deleted/Imaginary pairs and surplus added lines
 * become Imaginary/Inserted pairs. This reproduces DiffPlex's behavior where a
 * replaced block aligns line-for-line and only the ragged tail is filler.
 */
function emitReplaceBlock(
  removed: string[],
  added: string[],
  left: DiffRow[],
  right: DiffRow[],
): void {
  const paired = Math.min(removed.length, added.length);
  for (let i = 0; i < paired; i++) {
    const { left: lp, right: rp } = charPieces(removed[i], added[i]);
    left.push({ kind: 'modified', text: removed[i], pieces: lp });
    right.push({ kind: 'modified', text: added[i], pieces: rp });
  }
  // Surplus deletions: left shows the deleted line, right is filler.
  for (let i = paired; i < removed.length; i++) {
    left.push({ kind: 'deleted', text: removed[i] });
    right.push(imaginaryRow());
  }
  // Surplus insertions: right shows the inserted line, left is filler.
  for (let i = paired; i < added.length; i++) {
    left.push(imaginaryRow());
    right.push({ kind: 'inserted', text: added[i] });
  }
}

/**
 * Build the row-aligned two-column diff model from two shadow-buffer texts.
 *
 * Walks the jsdiff flat hunk list, coalescing a `removed` hunk that is immediately
 * followed by an `added` hunk into a single replace block (MODIFIED rows). Pure
 * additions/deletions are paired against imaginary filler rows so both columns
 * stay row-aligned for synced-scroll rendering.
 */
export function buildDiffModel(original: string, modified: string): DiffModel {
  const hunks = diffLines(original, modified);
  const left: DiffRow[] = [];
  const right: DiffRow[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const lines = splitLines(hunk.value);

    if (!hunk.added && !hunk.removed) {
      // Unchanged block — same text in both columns, row-for-row.
      for (const line of lines) {
        left.push({ kind: 'unchanged', text: line });
        right.push({ kind: 'unchanged', text: line });
      }
      continue;
    }

    if (hunk.removed) {
      const next = hunks[i + 1];
      if (next && next.added) {
        // removed-then-added → replace block (modified rows + ragged filler).
        emitReplaceBlock(lines, splitLines(next.value), left, right);
        i++; // consume the paired added hunk
      } else {
        // pure deletion: left shows it, right is filler.
        for (const line of lines) {
          left.push({ kind: 'deleted', text: line });
          right.push(imaginaryRow());
        }
      }
      continue;
    }

    // hunk.added (not preceded by a removed hunk) — pure insertion.
    for (const line of lines) {
      left.push(imaginaryRow());
      right.push({ kind: 'inserted', text: line });
    }
  }

  return { left, right };
}
