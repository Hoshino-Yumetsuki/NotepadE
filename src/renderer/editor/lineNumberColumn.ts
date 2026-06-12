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
 *     content LEFT, UNDER the gutter. A tiny ViewPlugin watches
 *     `scrollDOM.scrollLeft` and, while it is > 0, publishes two ready-made
 *     clip-path values on `.cm-scroller`: `--np-content-clip` =
 *     `inset(0 0 0 scrollLeft)` applied to EVERY `.cm-line` (line-local x <
 *     scrollLeft is exactly the part that slid under the sticky gutter) and
 *     `--np-layer-clip` = `inset(0 0 0 scrollLeft + gutterWidth)` applied to
 *     the selection/cursor `.cm-layer`s — whose local origin is the scroller's
 *     content origin, INCLUDING the gutter width. Text, selection rects and
 *     the caret are therefore never RENDERED under the gutter at all, so the
 *     transparent strip never shows them.
 *
 *     CRITICAL — the clip is per-LINE and conditional, NEVER on `.cm-content`:
 *     in a BigScaler document `.cm-content` is ~7,000,000px tall, and ANY
 *     `clip-path` on it (even a no-op `inset(0)`) makes Chromium rasterize a
 *     clip mask for the whole element. Past ~5–6M px that mask exceeds the
 *     compositor's limits: everything deeper simply stops painting AND CM6's
 *     measure loop destabilizes ("Measure loop restarted more than 5 times"),
 *     freezing the viewport — text and line numbers vanish when scrolling deep
 *     into a 100MB+ file. A `.cm-line` is one line tall, so its mask is tiny;
 *     and with no horizontal scroll the vars are unset → `clip-path: none`
 *     (the `var()` fallback), so the common path pays nothing at all.
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
    // under the sticky strip. Line-local x < scrollLeft is exactly the part
    // that slid under the gutter (each line's box starts at the gutter's right
    // edge), so clipping there hides it. --np-content-clip is published by
    // horizontalClipPlugin ONLY while scrollLeft > 0; with the var unset the
    // fallback is `none` and nothing is clipped.
    //
    // NEVER move this clip to `.cm-content`: in a BigScaler document that
    // element is ~7,000,000px tall and any clip-path on it forces Chromium to
    // rasterize a full-element clip mask, which blows the compositor's limits
    // past ~5–6M px — content deeper in the file stops painting entirely and
    // CM6's measure loop livelocks (frozen viewport). Per-line masks are tiny.
    '.cm-line': {
      clipPath: 'var(--np-content-clip, none)'
    },
    // Selection rectangles + the caret live in .cm-layer elements whose local
    // origin is the scroller CONTENT origin (left edge INCLUDING the gutter, per
    // @codemirror/view getBase: marker.left = clientX - (scrollerRect.left -
    // scrollLeft)), so their under-gutter region is [scrollLeft, scrollLeft +
    // gutterWidth] — the published clip insets by the sum. Same conditional
    // var: unset → `none`.
    '.cm-layer': {
      clipPath: 'var(--np-layer-clip, none)'
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
 * Publishes the two ready-made clip-path values (`--np-content-clip` on every
 * `.cm-line`, `--np-layer-clip` on the selection/cursor layers) on
 * `.cm-scroller` while the editor is horizontally scrolled, and REMOVES them at
 * scrollLeft = 0 so the resting state is `clip-path: none` (no mask at all —
 * see the module header for why a standing clip on huge surfaces is fatal).
 * Scroll writes are guarded (only on change) and read nothing but `scrollLeft`.
 *
 * The gutter width is re-read on geometry changes (digit growth, zoom) in the
 * plugin's OWN requestAnimationFrame — deliberately NOT via view.requestMeasure:
 * deep in a BigScaler document every measure iteration itself produces a
 * geometryChanged update (the scaler re-pins scrollTop each pass), so a plugin
 * that re-requests a measure from update() re-enters the measure loop on every
 * iteration until CM6 aborts with "Measure loop restarted more than 5 times" —
 * leaving the viewport half-updated (blank bands / missing lines when scrolling
 * deep into a 100MB+ file). One rAF read after CM6's cycle finishes is outside
 * that loop entirely and costs at most one layout read per frame.
 */
const horizontalClipPlugin = ViewPlugin.fromClass(
  class {
    private lastLeft = -1;
    private gutterWidth = 0;
    private rafId: number | null = null;
    private readonly onScroll: () => void;

    constructor(private readonly view: EditorView) {
      this.onScroll = () => this.syncScrollLeft();
      view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
      this.syncScrollLeft();
      this.scheduleWidthRead();
    }

    update(update: ViewUpdate): void {
      if (update.geometryChanged) {
        this.scheduleWidthRead();
        this.syncScrollLeft();
      }
    }

    destroy(): void {
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
      if (this.rafId != null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    /** Coalesced width read, OUTSIDE CM6's measure loop (see class docs). */
    private scheduleWidthRead(): void {
      if (this.rafId != null || typeof requestAnimationFrame !== 'function') return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        const gutters = this.view.scrollDOM.querySelector('.cm-gutters');
        const width = gutters instanceof HTMLElement ? gutters.offsetWidth : 0;
        if (width === this.gutterWidth) return;
        this.gutterWidth = width;
        // Re-publish the layer clip with the new width if currently scrolled.
        this.lastLeft = -1;
        this.syncScrollLeft();
      });
    }

    private syncScrollLeft(): void {
      const left = this.view.scrollDOM.scrollLeft;
      if (left === this.lastLeft) return;
      this.lastLeft = left;
      const style = this.view.scrollDOM.style;
      if (left > 0) {
        style.setProperty('--np-content-clip', `inset(0 0 0 ${left}px)`);
        style.setProperty('--np-layer-clip', `inset(0 0 0 ${left + this.gutterWidth}px)`);
      } else {
        // Resting state: no clip-path AT ALL (the var() fallback is `none`).
        style.removeProperty('--np-content-clip');
        style.removeProperty('--np-layer-clip');
      }
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
