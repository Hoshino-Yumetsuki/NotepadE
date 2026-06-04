import { useMemo, useRef, useCallback } from 'react';
import { buildDiffModel, type DiffRow } from './diffModel';
import { rowBackground, pieceBackground } from './diffColors';

/**
 * DiffViewer — RENDERER, Lane B (Phase 6). Self-contained, side-by-side diff with
 * synced scroll. Ports the UWP SideBySideDiffViewer: left column = original
 * (last-saved) text, right column = modified (current) text, row-aligned with
 * imaginary filler so the two panes scroll in lockstep.
 *
 * Color coding (UWP RichTextBlockDiffRenderer parity, see diffColors.ts):
 *   insert → green, delete → orange-red, modified → yellow (char-level), filler →
 *   light-cyan placeholder.
 *
 * MOUNT API (for the App.tsx integration pass — lane-a):
 *   <DiffViewer original={lastSavedText} modified={shadowText} />
 * where `original` is the tab's last-saved '\n' text and `modified` is the live
 * '\n' shadow buffer. The component is pure-presentational: it derives the diff
 * model from its two string props and renders; no IPC, no editor coupling.
 */

export interface DiffViewerProps {
  /** Left column — original / last-saved '\n'-normalized text. */
  original: string;
  /** Right column — modified / current '\n'-normalized shadow text. */
  modified: string;
  /** Optional monospace font family (defaults to the editor's Consolas stack). */
  fontFamily?: string;
  /** Optional font size in px (defaults to 14, the editor default). */
  fontSize?: number;
}

const MONO_FALLBACK = 'Consolas, "Courier New", monospace';

/** Render one row's content: plain text, or char-level pieces for modified rows. */
function RowContent({ row }: { row: DiffRow }): JSX.Element {
  if (row.kind === 'imaginary') {
    // Filler row — no text; a non-breaking space keeps the line height stable.
    return <>{' '}</>;
  }
  if (row.kind === 'modified' && row.pieces) {
    return (
      <>
        {row.pieces.map((piece, i) => {
          const bg = pieceBackground(piece.kind);
          return (
            <span
              key={i}
              style={bg ? { backgroundColor: bg } : undefined}
              data-piece-kind={piece.kind}
            >
              {piece.text.length > 0 ? piece.text : ' '}
            </span>
          );
        })}
      </>
    );
  }
  // Unchanged / inserted / deleted whole-line rows. Empty lines keep height.
  return <>{row.text.length > 0 ? row.text : ' '}</>;
}

/** A single scrollable column of diff rows. */
function DiffColumn({
  rows,
  side,
  scrollRef,
  onScroll,
  fontFamily,
  fontSize,
}: {
  rows: DiffRow[];
  side: 'left' | 'right';
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  fontFamily: string;
  fontSize: number;
}): JSX.Element {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid={`diff-column-${side}`}
      style={{
        flex: '1 1 50%',
        minWidth: 0,
        overflow: 'auto',
        fontFamily,
        fontSize,
        lineHeight: 1.5,
        whiteSpace: 'pre',
        boxSizing: 'border-box',
        borderRight: side === 'left' ? '1px solid rgba(128,128,128,0.4)' : undefined,
      }}
    >
      {rows.map((row, i) => {
        const bg = rowBackground(row.kind);
        return (
          <div
            key={i}
            data-row-kind={row.kind}
            style={{
              backgroundColor: bg ?? undefined,
              padding: '0 8px',
              minHeight: `${Math.round(fontSize * 1.5)}px`,
            }}
          >
            <RowContent row={row} />
          </div>
        );
      })}
    </div>
  );
}

export function DiffViewer({
  original,
  modified,
  fontFamily = MONO_FALLBACK,
  fontSize = 14,
}: DiffViewerProps): JSX.Element {
  const model = useMemo(() => buildDiffModel(original, modified), [original, modified]);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // Guard against the feedback loop when we programmatically mirror scrollTop.
  const syncing = useRef(false);

  const syncFrom = useCallback((from: 'left' | 'right') => {
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    const src = from === 'left' ? leftRef.current : rightRef.current;
    const dst = from === 'left' ? rightRef.current : leftRef.current;
    if (!src || !dst) return;
    if (dst.scrollTop === src.scrollTop && dst.scrollLeft === src.scrollLeft) return;
    syncing.current = true;
    dst.scrollTop = src.scrollTop;
    dst.scrollLeft = src.scrollLeft;
  }, []);

  return (
    <div
      data-testid="diff-viewer"
      style={{ display: 'flex', flexDirection: 'row', height: '100%', width: '100%' }}
    >
      <DiffColumn
        rows={model.left}
        side="left"
        scrollRef={leftRef}
        onScroll={() => syncFrom('left')}
        fontFamily={fontFamily}
        fontSize={fontSize}
      />
      <DiffColumn
        rows={model.right}
        side="right"
        scrollRef={rightRef}
        onScroll={() => syncFrom('right')}
        fontFamily={fontFamily}
        fontSize={fontSize}
      />
    </div>
  );
}
