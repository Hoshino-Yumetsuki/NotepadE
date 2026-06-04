/**
 * Diff color tokens — RENDERER, Lane B (Phase 6). PURE data (no DOM/IPC).
 *
 * 1:1 with the UWP RichTextBlockDiffRenderer color choices
 * (E:\Projects\Notepads\src\Notepads\Controls\DiffViewer\RichTextBlockDiffRenderer.cs):
 *   - Inserted  → Colors.LightGreen
 *   - Deleted   → Colors.OrangeRed
 *   - Modified  → Colors.Yellow  (character-level sub-piece tint)
 *   - Imaginary → Colors.Gray foreground over a Colors.LightCyan highlight (filler)
 *
 * The UWP control tints the FOREGROUND text brush (and uses a highlight layer for
 * imaginary filler). To keep the diff legible over both the dark (#2E2E2E) and
 * light (#F0F0F0) app backgrounds, the web port paints translucent line/piece
 * BACKGROUND bands in the same hues, plus a solid imaginary filler band. The hue
 * mapping is the load-bearing parity; the exact alpha is a presentation detail.
 */

import type { DiffRowKind, DiffPieceKind } from './diffModel';

/** Per-row background band for the side-by-side line. `null` = no band (unchanged). */
export function rowBackground(kind: DiffRowKind): string | null {
  switch (kind) {
    case 'inserted':
      // LightGreen band.
      return 'rgba(144, 238, 144, 0.30)';
    case 'deleted':
      // OrangeRed band.
      return 'rgba(255, 69, 0, 0.30)';
    case 'modified':
      // Yellow band (the changed sub-pieces get a stronger tint on top).
      return 'rgba(255, 255, 0, 0.18)';
    case 'imaginary':
      // LightCyan filler placeholder (the row carries no text).
      return 'rgba(224, 255, 255, 0.18)';
    case 'unchanged':
      return null;
  }
}

/**
 * Per-piece background for the character-level sub-pieces inside a MODIFIED row.
 * Unchanged sub-pieces get no extra tint (the row band shows through); inserted/
 * deleted spans get the green/orange-red hue so only the changed characters pop.
 */
export function pieceBackground(kind: DiffPieceKind): string | null {
  switch (kind) {
    case 'inserted':
      return 'rgba(144, 238, 144, 0.55)';
    case 'deleted':
      return 'rgba(255, 69, 0, 0.55)';
    case 'unchanged':
      return null;
  }
}
