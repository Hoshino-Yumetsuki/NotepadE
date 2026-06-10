/**
 * ============================================================================
 *  External line-number column — UWP-faithful, horizontal-scroll-proof gutter
 * ============================================================================
 *
 * CodeMirror's built-in `lineNumbers()` gutter is `position: sticky` INSIDE the
 * `.cm-scroller`. With word-wrap off, scrolling a long line to the right slides
 * the document text LEFT *under* the sticky gutter. That forces an impossible
 * choice: a transparent gutter lets the scrolled text show through and overlap
 * the numbers, while an opaque gutter hides the acrylic surface behind it (the
 * "不透明 / opaque block" complaint). The two requirements are contradictory in a
 * single scroller.
 *
 * UWP never had this problem because its line numbers live in a SEPARATE,
 * non-horizontally-scrolling grid column (TextEditorCore.LineNumbers.cs renders
 * number TextBlocks into their own Canvas beside the text ScrollViewer). This
 * module reproduces that structure: a line-number column rendered OUTSIDE the
 * scroller, synced to the editor's VERTICAL scroll only. Because no document text
 * ever travels behind it, the column can be fully transparent (acrylic shows
 * through) AND never overlaps text — the conflict is gone by construction.
 *
 * How it works:
 *   - A `<div class="cm-lineNumberColumn">` is appended to `view.dom` (NOT the
 *     scroller), absolutely positioned at the editor's left edge, transparent,
 *     `overflow: hidden`, `pointer-events: none`.
 *   - `view.scrollDOM` gets a left margin equal to the column width, so the text
 *     content starts to the RIGHT of the column and the freed strip is the
 *     column's home. Horizontal scroll moves the text within the scroller; the
 *     column, being outside it, does not move horizontally → no overlap, ever.
 *   - On every geometry/viewport/scroll update, one right-aligned number element
 *     per visible line block is positioned at `block.top - scrollTop`. A wrapped
 *     line is one block carrying ONE number at its top — correct under word-wrap.
 *
 * THEME: light/dark use a transparent column (acrylic shows through) with a muted
 * ~0.6α number color matching the editor body; HC uses an opaque `Canvas` column
 * (forced-colors paints flat system colors, no material), mirroring the
 * `.np-acrylic` high-contrast guard. Font family + size match the editor body
 * (size via the `--cm-zoom-font-size` variable so zoom tracks live).
 *
 * PA-8: pure renderer + DOM. No fs/path/child_process, no IPC.
 */

import { ViewPlugin, type PluginValue, type ViewUpdate, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Horizontal padding inside the column (px): gap before the separator + left inset. */
const COLUMN_PADDING_RIGHT = 8;
const COLUMN_PADDING_LEFT = 6;
/** Minimum digit slots so single-digit docs still get a comfortable column. */
const MIN_DIGITS = 2;

/** Options threaded from the host so the column matches the live theme + font. */
export interface LineNumberColumnOptions {
  /** Resolved theme bucket — picks number color; `hc` makes the column opaque. */
  themeMode: 'light' | 'dark' | 'hc';
  /** Editor body font family (numbers render in the same face, like UWP). */
  fontFamily: string;
  /** When true, the cursor's line number is brightened (active-line emphasis). */
  lineHighlighter: boolean;
}

/** Muted line-number foreground per theme (UWP #99000000 / #99EEEEEE ≈ 0.6α). */
export function numberColor(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'CanvasText';
  return themeMode === 'dark' ? 'rgba(238, 238, 238, 0.6)' : 'rgba(0, 0, 0, 0.6)';
}

/** Brightened active-line number color per theme. */
export function activeNumberColor(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'CanvasText';
  return themeMode === 'dark' ? 'rgba(238, 238, 238, 0.95)' : 'rgba(0, 0, 0, 0.95)';
}

/** Column background per theme: transparent (acrylic) for light/dark, opaque for HC. */
export function columnBackground(themeMode: 'light' | 'dark' | 'hc'): string {
  return themeMode === 'hc' ? 'Canvas' : 'transparent';
}

/** Digit slots needed for a document of `lineCount` lines (>= MIN_DIGITS). */
export function digitsFor(lineCount: number): number {
  return Math.max(MIN_DIGITS, String(Math.max(1, lineCount)).length);
}

export const COLUMN_PADDING = COLUMN_PADDING_LEFT + COLUMN_PADDING_RIGHT;

/**
 * Build the external line-number column extension. Mount it in place of CM6's
 * `lineNumbers()` (gate on the same showLineNumbers prop). Rebuild it (via a
 * Compartment.reconfigure) when themeMode / fontFamily / lineHighlighter change.
 */
export function lineNumberColumn(options: LineNumberColumnOptions): Extension {
  return ViewPlugin.define((view) => new LineNumberColumnPlugin(view, options));
}

/** One number cell's computed geometry, captured in the measure READ phase. */
interface CellSnapshot {
  lineNo: number;
  /** Column-relative top (block.top − scrollTop + content padding-top), px. */
  top: number;
  /** The full line block height (covers wrapped lines), px. */
  height: number;
}

/** Coherent read-phase snapshot the write phase paints from. */
interface LayoutSnapshot {
  /** Reserved column width for the current digit count, px. */
  width: number;
  /** Measured single-row line height (cells pin line-height to it), px. */
  lineH: number;
  /** 1-based active (cursor) line number, or -1 when not highlighted. */
  activeLine: number;
  cells: CellSnapshot[];
}

class LineNumberColumnPlugin implements PluginValue {
  private column: HTMLDivElement | null = null;
  /** Reused number elements, grown on demand (never shrunk — hidden when unused). */
  private cells: HTMLDivElement[] = [];
  private width = 0;
  private readonly onScroll: () => void;
  /**
   * Keyed measure request so multiple updates in one frame coalesce into a
   * single read/write pass (CM6 dedupes by `key`).
   */
  private readonly measureRequest = {
    key: this as unknown,
    read: (): LayoutSnapshot => this.readLayout(),
    write: (snap: LayoutSnapshot): void => this.writeLayout(snap)
  };

  constructor(
    private readonly view: EditorView,
    private readonly opts: LineNumberColumnOptions
  ) {
    // Pure vertical scroll: geometry (block tops, heights, scale) is stable, so
    // a synchronous relayout with the fresh scrollTop is safe AND keeps the
    // numbers glued to the text with zero frames of lag.
    this.onScroll = () => this.layout();
    this.mount();
    // Vertical scroll moves the numbers; horizontal scroll does NOT (the column is
    // outside the scroller). Listen on the scroller so the numbers track scrollTop.
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    // Initial paint synchronously: a fresh mount has no pending scroll-anchor
    // compensation, and the jsdom-level tests read the cells right after create.
    this.layout();
  }

  private mount(): void {
    const el = document.createElement('div');
    el.className = 'cm-lineNumberColumn';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.bottom = '0';
    el.style.left = '0';
    el.style.overflow = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.boxSizing = 'border-box';
    el.style.zIndex = '1';
    el.style.background = columnBackground(this.opts.themeMode);
    el.style.fontFamily = this.opts.fontFamily;
    // Size tracks the editor body via the zoom variable (Ctrl+/Ctrl-/Ctrl0 + wheel).
    el.style.fontSize = 'var(--cm-zoom-font-size)';
    el.style.lineHeight = '1.2';
    el.style.textAlign = 'right';
    el.style.color = numberColor(this.opts.themeMode);
    this.view.dom.appendChild(el);
    this.column = el;
  }

  /** Reserve the column's width on the scroller so text starts to its right. */
  private reserve(width: number): void {
    if (width === this.width) return;
    this.width = width;
    if (this.column) this.column.style.width = `${width}px`;
    // The scroller (and thus .cm-content) is inset by the column width; the column
    // overlays the freed strip. marginLeft (not padding) so horizontal scroll math
    // inside the scroller is unaffected.
    this.view.scrollDOM.style.marginLeft = `${width}px`;
  }

  /** Synchronous relayout (initial mount + pure scroll, where geometry is stable). */
  private layout(): void {
    if (!this.column) return;
    this.writeLayout(this.readLayout());
  }

  /**
   * READ phase: one coherent snapshot of everything the cells are positioned
   * from.
   *
   * Cell tops come from the RENDERED `.cm-line` rects, not from `block.top`
   * math. For documents taller than ~7,000,000px CM6 swaps in its BigScaler:
   * every `block.top` becomes a globally rescaled coordinate that (a) shifts
   * on EVERY edit (any insert changes total height → changes scale) while the
   * compensating scrollTop lands only later in the measure phase, and (b) is
   * built from heightMap ESTIMATES, so it sits a few px off the real DOM rows
   * even at rest (~0.06px/line of drift in a 500k-line doc). Both made the
   * numbers detach from their lines ("大文件下插入行全坏了"). The rendered
   * rects are what the user actually sees, by construction, under either
   * scaler. Rect reads belong in a measure READ phase — see update() for how
   * edits are routed through requestMeasure.
   */
  private readLayout(): LayoutSnapshot {
    const doc = this.view.state.doc;

    // Width from the digit count of the last line, measured in the column's own
    // font via a ch-based estimate (monospace-friendly; proportional fonts get a
    // slight over-estimate, which only adds harmless left padding).
    const digits = digitsFor(doc.lines);
    const charPx = this.measureCharWidth();
    const width = Math.ceil(digits * charPx) + COLUMN_PADDING;

    // CM6 advances each block by its MEASURED line height (read from a rendered
    // line via getBoundingClientRect), which for most fonts is NOT exactly
    // `1.2 × fontSize`. A naked cell (no height) draws its glyph in a CSS-ideal
    // `1.2em` box, so its half-leading differs from the content's and every number
    // sits a constant `(measured − 1.2·fontSize)/2` off its row. Giving each cell
    // the measured line-height (and the block's full height as the box) reproduces
    // the content's box exactly, so the number top-aligns to its first visual row —
    // matching CM6's own gutter and the UWP per-number measured-height TextBlock.
    const lineH = this.view.defaultLineHeight;
    // Active (cursor) line, for the brightened number when lineHighlighter is on.
    const head = this.view.state.selection.main.head;
    const activeLine = this.opts.lineHighlighter ? doc.lineAt(head).number : -1;

    const cells: CellSnapshot[] = [];

    // The column is pinned to view.dom's top, so a rendered line's
    // column-relative top is its viewport rect against view.dom's — already
    // incorporating live scrollTop, content padding and any scaler.
    const originTop = this.view.dom.getBoundingClientRect().top;
    // Fallback coordinates for lines without a rendered element yet (plugin
    // construction runs before the DocView paints; a measure pass follows and
    // re-runs this read). `block.top` is a DOCUMENT coordinate (0 = top of the
    // content region); the body adds `padding-top` on `.cm-content` (UWP
    // content inset, 6px) between this column's origin and where line 1 paints
    // — documentPadding.top is CM6's authoritative value for that inset.
    const scrollTop = this.view.scrollDOM.scrollTop;
    const padTop = this.view.documentPadding.top;

    for (const block of this.view.viewportLineBlocks) {
      const lineNo = doc.lineAt(block.from).number;
      let top = block.top - scrollTop + padTop;
      let height = block.height;
      // Prefer the RENDERED `.cm-line` rect over block math. For documents
      // taller than ~7,000,000px CM6 swaps in its BigScaler: every block.top
      // becomes a globally rescaled coordinate that (a) shifts on EVERY edit
      // (any insert changes total height → changes scale) while the
      // compensating scrollTop lands only later in the measure phase, and
      // (b) is built from heightMap estimates, so it sits a few px off the
      // real DOM rows even at rest. Both made the numbers detach from their
      // lines ("大文件下插入行全坏了"). The rendered rect is what the user
      // actually sees, by construction, under either scaler.
      const el = this.lineElementAt(block.from);
      if (el) {
        const rect = el.getBoundingClientRect();
        top = rect.top - originTop;
        height = rect.height;
      }
      cells.push({ lineNo, top, height });
    }
    return { width, lineH, activeLine, cells };
  }

  /** The rendered `.cm-line` element containing `pos`, or null if not painted. */
  private lineElementAt(pos: number): HTMLElement | null {
    try {
      let node: Node | null = this.view.domAtPos(pos).node;
      const content = this.view.contentDOM;
      while (node && node !== content) {
        if (node instanceof HTMLElement && node.parentNode === content) {
          return node.classList.contains('cm-line') ? node : null;
        }
        node = node.parentNode;
      }
    } catch {
      // domAtPos throws before the doc view exists (plugin construction) —
      // the caller falls back to block-coordinate math for this pass.
    }
    return null;
  }

  /** WRITE phase: apply the snapshot to the DOM (no layout reads). */
  private writeLayout(snap: LayoutSnapshot): void {
    if (!this.column) return;
    // marginLeft only moves on an ACTUAL width change (reserve() no-ops
    // otherwise). Writing it from here — a write phase, not mid-update — keeps
    // a digit-count growth from re-wrapping the content inside CM6's measure
    // loop, which used to thrash it into "Viewport failed to stabilize".
    this.reserve(snap.width);

    let i = 0;
    for (const c of snap.cells) {
      const cell = this.cellAt(i++);
      cell.textContent = String(c.lineNo);
      cell.style.top = `${c.top}px`;
      // Mirror the content's line box: a wrapped block is taller than one row, so
      // use the block height as the cell box but pin line-height to one measured
      // row — the single number then top-aligns to the block's first visual line.
      cell.style.height = `${c.height}px`;
      cell.style.lineHeight = `${snap.lineH}px`;
      cell.style.color =
        c.lineNo === snap.activeLine
          ? activeNumberColor(this.opts.themeMode)
          : numberColor(this.opts.themeMode);
      cell.style.display = 'block';
    }
    // Hide any leftover cells from a previously larger viewport.
    for (; i < this.cells.length; i++) this.cells[i].style.display = 'none';
  }

  /** A reusable absolutely-positioned number cell at index `i`. */
  private cellAt(i: number): HTMLDivElement {
    let cell = this.cells[i];
    if (!cell) {
      cell = document.createElement('div');
      cell.style.position = 'absolute';
      cell.style.right = `${COLUMN_PADDING_RIGHT}px`;
      cell.style.left = `${COLUMN_PADDING_LEFT}px`;
      cell.style.textAlign = 'right';
      this.column!.appendChild(cell);
      this.cells[i] = cell;
    }
    return cell;
  }

  private measureCharWidth(): number {
    const cw = this.view.defaultCharacterWidth;
    if (cw && cw > 0) return cw * 1.12;
    return this.view.defaultLineHeight * 0.5;
  }

  update(u: ViewUpdate): void {
    // Re-attach if CM6 / React rebuilt the host DOM under us.
    if (!this.column || !this.column.isConnected) {
      this.column = null;
      this.cells = [];
      this.width = 0;
      this.mount();
    }
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.selectionSet) {
      // NOT a synchronous layout: during update() CM6 has new (possibly
      // BigScaler-rescaled) block tops but has NOT yet applied its scroll-anchor
      // scrollTop compensation — that lands in the measure phase. Deferring via
      // requestMeasure reads blocks + scrollTop as one coherent snapshot after
      // the compensation, and re-runs after geometryChanged (startup/zoom font
      // re-measure), so the transient-default-line-height window self-heals
      // exactly as before. Any later scrollTop adjustment also fires the
      // scroller's scroll event, whose synchronous relayout re-glues the cells.
      this.view.requestMeasure(this.measureRequest);
    }
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    // Release the reserved strip so a later mount without the column starts clean.
    this.view.scrollDOM.style.marginLeft = '';
    this.column?.remove();
    this.column = null;
    this.cells = [];
  }
}
