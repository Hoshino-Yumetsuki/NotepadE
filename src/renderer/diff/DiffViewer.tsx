import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { buildDiffModel, type DiffRow, type DiffModel } from './diffModel';
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

/**
 * A single scrollable column of diff rows, WINDOWED: only the rows in (and a small
 * overscan band around) the visible viewport are mounted, with top/bottom spacer
 * divs of the exact missing height so the scroll height — and therefore the
 * row-for-row alignment with the opposite column and the synced-scroll math — is
 * pixel-identical to rendering every row. Row height is FIXED (minHeight =
 * round(fontSize*1.5), matching the per-row style below), so the visible slice is
 * pure scroll-arithmetic with no per-row measurement.
 *
 * HORIZONTAL EXTENT: rows are whiteSpace:'pre' (no wrap), so each row's intrinsic
 * width varies and the container's scrollWidth would otherwise follow the widest
 * CURRENTLY-MOUNTED row — meaning vertical scrolling could mount/unmount a long
 * line and shift the horizontal scrollbar. To keep the extent CONSTANT (matching
 * the un-windowed component, whose extent was the global widest row), each spacer
 * div is given a minWidth equal to the global widest row's full box width
 * (maxChars × 1ch + the 0/8px row padding; the font is monospace so 1ch == one
 * column). A spacer is always present whenever any row is unmounted (see topPad/
 * bottomPad reasoning below), so the spacers alone pin scrollWidth without touching
 * the visible rows — their rendered styles stay byte-identical to before.
 *
 * When the viewport height is unknown (0) — e.g. jsdom under test, or a not-yet-
 * laid-out mount — windowing is bypassed and ALL rows render (no spacers), so the
 * rendered DOM is byte-for-byte what the un-windowed component produced.
 */
function DiffColumn({
  rows,
  side,
  scrollRef,
  onScroll,
  fontFamily,
  fontSize
}: {
  rows: DiffRow[];
  side: 'left' | 'right';
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  fontFamily: string;
  fontSize: number;
}): JSX.Element {
  const rowHeight = Math.round(fontSize * 1.5);
  // Overscan a few rows beyond the viewport so a fast scroll never flashes blank
  // rows before the next render commits.
  const OVERSCAN = 8;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // Global widest row (in characters), so a spacer can reserve a constant
  // horizontal extent regardless of which slice is mounted. Empty/imaginary rows
  // render a single ' ', so they never exceed a real line's length.
  const maxChars = useMemo(() => {
    let m = 0;
    for (const row of rows) if (row.text.length > m) m = row.text.length;
    return m;
  }, [rows]);
  // Full box width of the widest row: maxChars columns (1ch each, monospace) plus
  // the 0/8px horizontal row padding. Spacers use this as minWidth to pin extent.
  const extentWidth = `calc(${maxChars}ch + 16px)`;

  // Track the viewport height (clientHeight). Measured on mount and whenever the
  // element resizes, so the window covers exactly the visible band.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setViewportH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  const handleScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
    // Preserve the parent's scroll-sync (mirrors scrollTop/Left to the other
    // column); the mirrored assignment fires this same handler on that column, so
    // both windows stay aligned.
    onScroll();
  }, [scrollRef, onScroll]);

  const total = rows.length;
  // viewportH === 0 (jsdom / pre-layout) → render everything (no windowing), so
  // the DOM is identical to the un-windowed component.
  const windowed = viewportH > 0;
  const start = windowed ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const end = windowed
    ? Math.min(total, Math.ceil((scrollTop + viewportH) / rowHeight) + OVERSCAN)
    : total;
  const topPad = start * rowHeight;
  const bottomPad = (total - end) * rowHeight;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
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
        borderRight: side === 'left' ? '1px solid rgba(128,128,128,0.4)' : undefined
      }}
    >
      {topPad > 0 ? (
        <div style={{ height: topPad, minWidth: extentWidth }} aria-hidden="true" />
      ) : null}
      {rows.slice(start, end).map((row, i) => {
        const bg = rowBackground(row.kind);
        return (
          <div
            key={start + i}
            data-row-kind={row.kind}
            style={{
              backgroundColor: bg ?? undefined,
              padding: '0 8px',
              minHeight: `${rowHeight}px`
            }}
          >
            <RowContent row={row} />
          </div>
        );
      })}
      {bottomPad > 0 ? (
        <div style={{ height: bottomPad, minWidth: extentWidth }} aria-hidden="true" />
      ) : null}
    </div>
  );
}

export function DiffViewer({
  original,
  modified,
  fontFamily = MONO_FALLBACK,
  fontSize = 14
}: DiffViewerProps): JSX.Element {
  const [model, setModel] = useState<DiffModel>({ left: [], right: [] });
  useEffect(() => {
    let cancelled = false;
    void buildDiffModel(original, modified).then((m) => {
      if (!cancelled) setModel(m);
    });
    return () => {
      cancelled = true;
    };
  }, [original, modified]);

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
