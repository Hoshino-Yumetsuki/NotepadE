/**
 * ============================================================================
 *  Line-number gutter — STRUCTURAL alignment via CodeMirror 6's native gutter
 * ============================================================================
 *
 * This replaces the former measure-and-follow external column. That column
 * mounted OUTSIDE `.cm-scroller` and absolutely positioned one number cell per
 * visible line by reading rendered `.cm-line` rects every frame. The approach
 * could never FORCE alignment — it could only chase it:
 *   - Zoom (the `--cm-zoom-font-size` variable) resized the text behind CM6's
 *     back, so the column re-measured a frame late and the numbers drifted
 *     (zoom-out especially: numbers slid left-down while lines shrank correctly).
 *   - In a ~920k-line document CM6's BigScaler rescales every `block.top` on
 *     EVERY edit (total height changes → global scale changes); the measured
 *     column lagged or broke outright on a mid-file insert.
 *
 * CM6's built-in `lineNumbers()` gutter is laid out by CM6 itself, per line,
 * inside the same scroll DOM as the content. The numbers are therefore aligned
 * to their lines BY CONSTRUCTION at any zoom and any document size — including
 * BigScaler docs — with no measurement, no rect reads, and no per-frame catch-up.
 * That is the structural guarantee the re-implementation requires.
 *
 * Visual parity with the old column is reproduced purely through gutter THEMING
 * (EditorView.theme on `.cm-gutters` / `.cm-lineNumbers` / `.cm-gutterElement`):
 *   - font-size tracks `--cm-zoom-font-size` so zoom stays live; font-family is
 *     the editor body face; numbers are right-aligned and muted (~0.6α body
 *     color), brightened on the active line when the line highlighter is on.
 *   - the gutter background is fully TRANSPARENT (HC: opaque `Canvas`), so the
 *     strip shows exactly the app root tint → window acrylic/vibrancy and
 *     follows the transparency slider with no double-tint — the gutter reads as
 *     the SAME material as the rest of the app.
 *   - no-overlap on horizontal scroll is guaranteed by CLIPPING, not masking:
 *     the native gutter is `position: sticky; left: 0; z-index: 200` inside the
 *     scroller, so with word-wrap off a long line scrolled right slides the
 *     content LEFT, UNDER the gutter. A tiny ViewPlugin mirrors
 *     `scrollDOM.scrollLeft` into the `--np-hclip` CSS variable (and the gutter
 *     width into `--np-gutter-w`); `.cm-content` is clipped at
 *     `inset(0 0 0 var(--np-hclip))` (content-local x < scrollLeft is exactly
 *     the part that slid under the sticky gutter) and the selection/cursor
 *     `.cm-layer`s — whose local origin is the scroller's content origin,
 *     INCLUDING the gutter width — at `inset(0 0 0 calc(--np-hclip +
 *     --np-gutter-w))`. Text, selection rects and the caret are therefore never
 *     RENDERED under the gutter at all, so the transparent strip never shows
 *     them.
 *   - width grows with the digit count automatically (CM6 sizes the gutter to
 *     its widest element).
 *
 * The line-number reveal glow (lineNumberGlow.ts) reads `.cm-gutters` for the
 * boundary it lights; the gutter is a stable CM6-owned element, so the glow
 * tracks it without any measure plumbing.
 *
 * PA-8: pure renderer + CM6 extension. No fs/path/child_process, no IPC.
 */

import { EditorView, ViewPlugin, lineNumbers, highlightActiveLineGutter } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Options threaded from the host so the gutter matches the live theme + font. */
export interface LineNumberColumnOptions {
  /** Resolved theme bucket — picks number color; `hc` makes the gutter opaque. */
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

/**
 * Gutter background per theme. Fully TRANSPARENT for light/dark so the strip
 * shows the app root tint → window acrylic/vibrancy directly — the gutter is
 * the SAME live material as the rest of the app (slider included), with no
 * double-tint. Safe because nothing is ever rendered under the strip: the
 * horizontal-clip plugin (see module header) clips `.cm-content` and the
 * selection/cursor layers at the gutter edge. HC stays the flat system
 * `Canvas` (opaque — no material in high contrast).
 */
export function columnBackground(themeMode: 'light' | 'dark' | 'hc'): string {
  return themeMode === 'hc' ? 'Canvas' : 'transparent';
}

/** Minimum digit slots so single-digit docs still get a comfortable column. */
const MIN_DIGITS = 2;

/** Digit slots needed for a document of `lineCount` lines (>= MIN_DIGITS). */
export function digitsFor(lineCount: number): number {
  return Math.max(MIN_DIGITS, String(Math.max(1, lineCount)).length);
}

/** Horizontal padding inside the gutter cell (px): left inset + right gap. */
const CELL_PADDING_LEFT = 6;
const CELL_PADDING_RIGHT = 8;

/**
 * Theme the native gutter to the live app theme + zoom. Kept separate from the
 * extension factory so it can be unit-tested in isolation and so the selectors
 * stay PLAIN `.cm-*` (no `&dark`/`&light` ancestor selectors, which CM6's
 * EditorView.theme rejects at construction — the host chooses colors in JS).
 */
export function lineNumberTheme(options: LineNumberColumnOptions): Extension {
  const { themeMode, fontFamily, lineHighlighter } = options;
  return EditorView.theme({
    '.cm-gutters': {
      // Transparent (HC: Canvas) — the strip IS the app material; see
      // columnBackground. The clip rules below guarantee nothing renders
      // beneath it during horizontal scroll.
      backgroundColor: columnBackground(themeMode),
      color: numberColor(themeMode),
      border: 'none',
      // Keep CM6's fixed gutter intact: sticky at the scroller's left edge, above
      // the content. CM6 already sets these, but we restate them so the no-overlap
      // guarantee can't be silently lost by another extension's gutter theme.
      position: 'sticky',
      left: '0',
      zIndex: '200',
      fontFamily,
      // Size tracks the editor body via the zoom variable (Ctrl+/Ctrl-/Ctrl0 +
      // wheel) so the numbers scale in lockstep with the content — structurally,
      // because CM6 lays out the gutter cells AFTER this size is resolved.
      fontSize: 'var(--cm-zoom-font-size)'
    },
    // No-overlap guarantee for the TRANSPARENT gutter: never render content
    // under the sticky strip. Content-local x < scrollLeft is exactly the part
    // that slid under the gutter (the content box starts at the gutter's right
    // edge), so clipping there hides it. --np-hclip is mirrored from
    // scrollDOM.scrollLeft by horizontalClipPlugin; with the var unset/0 the
    // inset is 0 and nothing is clipped.
    '.cm-content': {
      clipPath: 'inset(0 0 0 var(--np-hclip, 0px))'
    },
    // Selection rectangles + the caret live in .cm-layer elements whose local
    // origin is the scroller CONTENT origin (left edge INCLUDING the gutter, per
    // @codemirror/view getBase: marker.left = clientX - (scrollerRect.left -
    // scrollLeft)), so their under-gutter region is [scrollLeft, scrollLeft +
    // gutterWidth] — clip at the sum.
    '.cm-layer': {
      clipPath: 'inset(0 0 0 calc(var(--np-hclip, 0px) + var(--np-gutter-w, 0px)))'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      // Right-aligned numbers with UWP-style insets; min-width keeps a stable
      // column for short docs (CM6 grows it past this as the digit count rises).
      padding: `0 ${CELL_PADDING_RIGHT}px 0 ${CELL_PADDING_LEFT}px`,
      minWidth: `${MIN_DIGITS}ch`,
      textAlign: 'right',
      color: numberColor(themeMode)
    },
    // Active (cursor) line number: brightened only when the line highlighter is
    // on, mirroring the old column's active-line emphasis. highlightActiveLine-
    // Gutter() (mounted below) tags the active cell with .cm-activeLineGutter.
    ...(lineHighlighter
      ? {
          '.cm-lineNumbers .cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color: activeNumberColor(themeMode)
          }
        }
      : {})
  });
}

/**
 * Mirrors the scroller's horizontal scroll offset into `--np-hclip` and the
 * gutter's current width into `--np-gutter-w` (both on `.cm-scroller`), feeding
 * the clip-path rules in `lineNumberTheme`. Scroll writes are guarded (only on
 * change) and read nothing but `scrollLeft`; the gutter width is read in CM6's
 * measure phase (geometry changes: digit growth, zoom) to avoid layout thrash.
 */
const horizontalClipPlugin = ViewPlugin.fromClass(
  class {
    private lastLeft = -1;
    private lastGutterWidth = -1;
    private readonly onScroll: () => void;
    private readonly measureReq: { read: () => number; write: (width: number) => void };

    constructor(private readonly view: EditorView) {
      this.onScroll = () => this.syncScrollLeft();
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.measureReq = {
        read: () => {
          const gutters = this.view.scrollDOM.querySelector('.cm-gutters');
          return gutters instanceof HTMLElement ? gutters.offsetWidth : 0;
        },
        write: (width: number) => this.writeGutterWidth(width)
      };
      this.syncScrollLeft();
      view.requestMeasure(this.measureReq);
    }

    update(update: ViewUpdate): void {
      if (update.geometryChanged) {
        this.view.requestMeasure(this.measureReq);
        this.syncScrollLeft();
      }
    }

    destroy(): void {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    }

    private syncScrollLeft(): void {
      const left = this.view.scrollDOM.scrollLeft;
      if (left === this.lastLeft) return;
      this.lastLeft = left;
      this.view.scrollDOM.style.setProperty('--np-hclip', `${left}px`);
    }

    private writeGutterWidth(width: number): void {
      if (width === this.lastGutterWidth) return;
      this.lastGutterWidth = width;
      this.view.scrollDOM.style.setProperty('--np-gutter-w', `${width}px`);
    }
  }
);

/**
 * Build the line-number gutter extension. Mount it gated on the showLineNumbers
 * prop (a Compartment in CodeMirrorEditor.tsx). Rebuild it via
 * Compartment.reconfigure when themeMode / fontFamily / lineHighlighter change.
 *
 * Composes CM6's native `lineNumbers()` (structural per-line gutter) with the
 * theme above, the horizontal clip plugin (transparent gutter + content clip =
 * no overlap), plus `highlightActiveLineGutter()` when the line highlighter is
 * on so the active number can be brightened.
 */
export function lineNumberColumn(options: LineNumberColumnOptions): Extension {
  return [
    lineNumbers(),
    options.lineHighlighter ? highlightActiveLineGutter() : [],
    lineNumberTheme(options),
    horizontalClipPlugin
  ];
}
