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

class LineNumberColumnPlugin implements PluginValue {
  private column: HTMLDivElement | null = null;
  /** Reused number elements, grown on demand (never shrunk — hidden when unused). */
  private cells: HTMLDivElement[] = [];
  private width = 0;
  private readonly onScroll: () => void;

  constructor(
    private readonly view: EditorView,
    private readonly opts: LineNumberColumnOptions,
  ) {
    this.onScroll = () => this.layout();
    this.mount();
    // Vertical scroll moves the numbers; horizontal scroll does NOT (the column is
    // outside the scroller). Listen on the scroller so the numbers track scrollTop.
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
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

  private layout(): void {
    const col = this.column;
    if (!col) return;
    const doc = this.view.state.doc;
    const lineCount = doc.lines;

    // Width from the digit count of the last line, measured in the column's own
    // font via a ch-based estimate (monospace-friendly; proportional fonts get a
    // slight over-estimate, which only adds harmless left padding).
    const digits = digitsFor(lineCount);
    const charPx = this.measureCharWidth();
    this.reserve(Math.ceil(digits * charPx) + COLUMN_PADDING);

    const scrollTop = this.view.scrollDOM.scrollTop;
    // `block.top` is a DOCUMENT coordinate (0 = top of the content region). The
    // editor body adds `padding-top` on `.cm-content` (UWP content inset, 6px),
    // which sits between this column's origin (view.dom top, shared with the
    // scroller) and where line 1 actually paints. Omitting it rode every number
    // ~6px above its text row — a constant misalignment at any scroll offset.
    // documentPadding.top is CM6's authoritative value for that inset, so the
    // numbers track their lines even if the padding changes.
    const padTop = this.view.documentPadding.top;
    // CM6 advances each block by its MEASURED line height (read from a rendered
    // line via getBoundingClientRect), which for most fonts is NOT exactly
    // `1.2 × fontSize`. A naked cell (no height) draws its glyph in a CSS-ideal
    // `1.2em` box, so its half-leading differs from the content's and every number
    // sits a constant `(measured − 1.2·fontSize)/2` off its row. Giving each cell
    // the measured line-height (and the block's full height as the box) reproduces
    // the content's box exactly, so the number top-aligns to its first visual row —
    // matching CM6's own gutter and the UWP per-number measured-height TextBlock.
    const lineH = this.view.defaultLineHeight;
    const blocks = this.view.viewportLineBlocks;
    // Active (cursor) line, for the brightened number when lineHighlighter is on.
    const head = this.view.state.selection.main.head;
    const activeLine = this.opts.lineHighlighter ? doc.lineAt(head).number : -1;

    let i = 0;
    for (const block of blocks) {
      const lineNo = doc.lineAt(block.from).number;
      const cell = this.cellAt(i++);
      cell.textContent = String(lineNo);
      cell.style.top = `${block.top - scrollTop + padTop}px`;
      // Mirror the content's line box: a wrapped block is taller than one row, so
      // use the block height as the cell box but pin line-height to one measured
      // row — the single number then top-aligns to the block's first visual line.
      cell.style.height = `${block.height}px`;
      cell.style.lineHeight = `${lineH}px`;
      cell.style.color =
        lineNo === activeLine
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
      this.layout();
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
