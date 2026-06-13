/**
 * Side-by-side diff MODEL — RENDERER, Lane B (Phase 6).
 *
 * Delegates diff computation to the Rust backend (`similar` crate) via IPC,
 * keeping the renderer main thread free for large files. The Rust command
 * returns the same two-column aligned model that the JS implementation produced.
 *
 * PA-8: no fs/path/child_process, no DOM. Calls window.notepads.diff.compute.
 */

/** Per-row change classification (mirrors DiffPlex ChangeType for our columns). */
export type DiffRowKind = 'unchanged' | 'inserted' | 'deleted' | 'modified' | 'imaginary';

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

const EMPTY_MODEL: DiffModel = { left: [], right: [] };

/**
 * Build the row-aligned two-column diff model from two shadow-buffer texts.
 * Computation runs in Rust via IPC (non-blocking for the renderer thread).
 */
export async function buildDiffModel(original: string, modified: string): Promise<DiffModel> {
  if (original === modified) return EMPTY_MODEL;
  const res = await window.notepads.diff.compute(original, modified);
  if (!res.ok) return EMPTY_MODEL;
  return res.data as DiffModel;
}
