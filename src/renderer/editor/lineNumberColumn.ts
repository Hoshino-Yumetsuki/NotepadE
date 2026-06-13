/**
 * ============================================================================
 *  Native line-number gutter theme — acrylic-faithful, horizontal-scroll-proof
 * ============================================================================
 *
 * CodeMirror's built-in `lineNumbers()` gutter is `position: sticky` INSIDE the
 * `.cm-scroller`. CM6 owns its per-line layout, so the numbers stay vertically
 * aligned with the text at ANY zoom and ANY document size by construction — the
 * reason we use the native gutter rather than a hand-positioned external column.
 *
 * The native gutter cannot carry the OS acrylic material itself: it is
 * `position: sticky`, which Chromium promotes to its own compositing layer, and
 * on Windows that layer composites WITHOUT the window vibrancy
 * (window_vibrancy::apply_acrylic) — so any background painted on the gutter
 * renders flat/solid with NO material (true for transparent, tinted, or blurred).
 * The content area shows material only because it is NOT promoted.
 *
 * So the gutter stays TRANSPARENT (light/dark) and the material is supplied by a
 * separate full-height background strip (`gutterMaterial`) mounted on `view.dom`
 * — a plain, NON-promoted absolutely positioned element that DOES sample the
 * acrylic (the same trick the old external column used, minus the per-line cells
 * that caused the zoom drift). The strip sits behind the scroller at z-index -1,
 * so the transparent gutter above reveals it; a translucent dark wash tints it a
 * touch darker than the editor surface so the column reads as its own panel.
 *
 * NOTE: we deliberately do NOT use `backdrop-filter`. Chromium's backdrop-filter
 * samples only in-page paint and cannot reproduce the OS vibrancy either.
 *
 * THEME: light/dark use the transparent gutter + acrylic strip (slightly darker)
 * with a muted ~0.6α number color matching the editor body; HC uses an opaque
 * `Canvas` gutter and NO strip (forced-colors paints flat system colors, no
 * material), mirroring the `.np-acrylic` high-contrast guard. The gutter font size
 * follows the `--cm-zoom-font-size` variable (see commands/zoom.ts) so zoom tracks
 * live; the font family is inherited from the editor body.
 *
 * PA-8: pure renderer theme. No fs/path/child_process, no IPC.
 */

import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** Horizontal padding inside the gutter (px): gap before the separator + inset. */
const COLUMN_PADDING_RIGHT = 8;
const COLUMN_PADDING_LEFT = 6;
/** Minimum digit slots so single-digit docs still get a comfortable column. */
const MIN_DIGITS = 2;

/** Options threaded from the host so the gutter matches the live theme. */
export interface GutterThemeOptions {
  /** Resolved theme bucket — picks number color; `hc` makes the gutter opaque. */
  themeMode: 'light' | 'dark' | 'hc';
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
 * Gutter background per theme. Light/dark use a TRANSLUCENT dark wash: the OS
 * acrylic shows through (so the gutter is still "material"), but tinted a little
 * darker than the editor surface so the column reads as its own panel. HC uses an
 * opaque system `Canvas` (forced-colors paints flat, no material).
 */
export function columnBackground(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'Canvas';
  // Black wash over the acrylic: subtle on light, stronger on dark, so in both
  // cases the gutter is a touch darker than the input area without going opaque.
  return themeMode === 'dark' ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.06)';
}

/** Digit slots needed for a document of `lineCount` lines (>= MIN_DIGITS). */
export function digitsFor(lineCount: number): number {
  return Math.max(MIN_DIGITS, String(Math.max(1, lineCount)).length);
}

export const COLUMN_PADDING = COLUMN_PADDING_LEFT + COLUMN_PADDING_RIGHT;

/**
 * Build the native line-number gutter theme. Mount it ALONGSIDE CM6's
 * `lineNumbers()` (gate both on the same showLineNumbers prop). Rebuild it (via a
 * Compartment.reconfigure) when themeMode / lineHighlighter change.
 *
 * Only plain `.cm-*` descendant selectors are used — CM6's EditorView.theme
 * throws on `&dark`-style ancestor selectors, so per-theme colors are chosen in
 * JS (numberColor / columnBackground).
 */
export function buildGutterTheme(opts: GutterThemeOptions): Extension {
  const { themeMode, lineHighlighter } = opts;
  const rest = numberColor(themeMode);
  const active = activeNumberColor(themeMode);

  return EditorView.theme({
    // The gutter container is TRANSPARENT on light/dark so the material strip
    // behind it (gutterMaterial, mounted on view.dom — a NON-promoted element that
    // samples the OS acrylic) shows through. The gutter itself is `position:
    // sticky`, which Chromium promotes to its own compositing layer; on Windows
    // that layer composites WITHOUT the OS vibrancy, so any background painted
    // directly on the gutter renders flat/solid. Keeping the gutter transparent
    // lets the promoted layer reveal the acrylic strip beneath it. HC has no
    // material, so it paints an opaque Canvas panel on the gutter directly.
    //
    // No border — the reveal glow (lineNumberGlow.ts) owns the divider; the default
    // CM6 gutter border would read as an opaque seam.
    '.cm-gutters': {
      backgroundColor: themeMode === 'hc' ? columnBackground('hc') : 'transparent',
      border: 'none',
      color: rest,
      // Font size follows the zoom variable so numbers scale with the content;
      // CM6 positions each number per line-block, so vertical alignment holds.
      fontSize: 'var(--cm-zoom-font-size)'
    },
    '.cm-lineNumbers .cm-gutterElement': {
      color: rest,
      padding: `0 ${COLUMN_PADDING_RIGHT}px 0 ${COLUMN_PADDING_LEFT}px`
    },
    // Active-line number emphasis, gated on the "Highlight current line" toggle.
    // The gutter element's own background stays transparent so the acrylic is
    // never blocked behind the active line.
    ...(lineHighlighter
      ? {
          '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
            color: active
          }
        }
      : {})
  });
}

// ---------------------------------------------------------------------------
//  Gutter material strip
// ---------------------------------------------------------------------------

/**
 * The native gutter can't carry the OS acrylic itself: `position: sticky`
 * promotes it to its own compositing layer, which on Windows composites WITHOUT
 * the window vibrancy and paints flat/solid. So instead we mount a full-height
 * background strip on `view.dom` (the `.cm-editor` root) — a plain absolutely
 * positioned, NON-promoted element that DOES sample the acrylic (exactly like the
 * old external column did, minus the per-line cells that caused the zoom drift).
 *
 * The strip sits at `z-index: -1` behind the scroller, so the transparent gutter
 * above reveals it; its translucent wash tints the acrylic a touch darker than the
 * editor surface. It tracks the live gutter width so it always lines up with the
 * numbers. HC has no material → no strip (the gutter paints an opaque Canvas).
 *
 * Requires the editor root to be an isolated stacking context (position: relative
 * + isolation: isolate; set in buildEditorTheme) so the negative z-index stays
 * behind the content but in front of the editor's transparent background.
 */
export function gutterMaterial(themeMode: 'light' | 'dark' | 'hc'): Extension {
  if (themeMode === 'hc') return [];
  const wash = columnBackground(themeMode);
  return ViewPlugin.define((view) => new GutterMaterialPlugin(view, wash));
}

class GutterMaterialPlugin implements PluginValue {
  private strip: HTMLDivElement | null = null;
  private width = -1;

  constructor(
    private readonly view: EditorView,
    private readonly wash: string
  ) {
    this.mount();
  }

  private gutters(): HTMLElement | null {
    return this.view.dom.querySelector<HTMLElement>('.cm-gutters');
  }

  private mount(): void {
    const gutters = this.gutters();
    if (!gutters) return;
    this.width = gutters.getBoundingClientRect().width;
    const el = document.createElement('div');
    el.className = 'cm-gutterMaterial';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.bottom = '0';
    el.style.width = `${this.width}px`;
    el.style.background = this.wash;
    el.style.pointerEvents = 'none';
    // Behind the scroller (which paints the numbers) but in front of the editor's
    // transparent background, so the OS acrylic shows through the wash.
    el.style.zIndex = '-1';
    // Prepend so it never paints over later siblings (e.g. the reveal glow).
    this.view.dom.insertBefore(el, this.view.dom.firstChild);
    this.strip = el;
  }

  update(_update: ViewUpdate): void {
    const gutters = this.gutters();
    if (gutters && this.strip) {
      const w = gutters.getBoundingClientRect().width;
      if (w !== this.width) {
        this.width = w;
        this.strip.style.width = `${w}px`;
      }
    }
    if (this.strip && !this.strip.isConnected) {
      this.strip = null;
      this.mount();
    }
  }

  destroy(): void {
    this.strip?.remove();
    this.strip = null;
  }
}
