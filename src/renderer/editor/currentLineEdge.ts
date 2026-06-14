/**
 * Current-line edge filler (RENDERER, Monaco port).
 *
 * `.monaco-editor` carries a CSS `padding-left` inset (the gutter breathing room).
 * That padding is OUTSIDE Monaco's painted region — Monaco's `.overflow-guard`
 * (which clips all content/overlays, `overflow:hidden`) starts at the content-box
 * left, i.e. AFTER the padding. So Monaco's `renderLineHighlight:'all'` current-
 * line band begins at the gutter's left edge and can never reach into the padding:
 * the gray band stops short of the window's left edge, leaving a visible gap.
 *
 * A CSS pseudo-element on Monaco's own `.current-line-margin` can't fill the gap
 * either — it would be clipped by `.overflow-guard`. The robust fix is a sibling
 * overlay appended to the editor ROOT (which is `overflow:visible` and spans the
 * full padding box): a thin strip in the `[0, inset)` region that tracks the
 * active line's Y, painted in the SAME color as the theme's line-highlight token.
 * Together with Monaco's own band, the highlight then reads as continuous from the
 * window's left edge across the gutter and into the text.
 *
 * THEME: light/dark aware, matching `editor.lineHighlightBackground` exactly. HC
 * paints no line highlight → the attach is inert (no-op disposer).
 *
 * Perf: only `top`/`height`/`width`/`display` are written, coalesced into one rAF.
 *
 * PA-8: pure renderer data + DOM-only positioning.
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface CurrentLineEdgeOptions {
  themeMode: 'light' | 'dark' | 'hc';
}

/**
 * Current-line strip color per theme. These match the Monaco theme tokens set in
 * MonacoEditor.defineThemes EXACTLY (`editor.lineHighlightBackground`): light
 * `#7f7f7f14`, dark `#ffffff0d`. Both composite over the same transparent acrylic
 * surface as Monaco's own band, so the resulting shade is identical. HC paints no
 * line highlight → 'transparent' (the attach becomes a no-op).
 */
export function currentLineEdgeColor(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'transparent';
  return themeMode === 'dark' ? '#ffffff0d' : '#7f7f7f14';
}

/**
 * Attach the current-line edge filler to a live Monaco editor. Returns a disposer
 * that removes the overlay + all listeners. Inert (no-op disposer) for HC or when
 * the editor has no DOM node yet.
 */
export function attachCurrentLineEdge(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: CurrentLineEdgeOptions
): () => void {
  const color = currentLineEdgeColor(options.themeMode);
  const root = editor.getDomNode();
  if (color === 'transparent' || !root) return () => {};

  const overlay = document.createElement('div');
  overlay.className = 'monaco-currentLineEdge';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '0';
  overlay.style.height = '0';
  overlay.style.pointerEvents = 'none';
  // Back-most overlay: it only ever occupies the left padding gutter region (which
  // Monaco's content/overlays never cover), so z-order is cosmetic, but keeping it
  // low guarantees it never paints over the line numbers or text.
  overlay.style.zIndex = '0';
  overlay.style.background = color;
  overlay.style.display = 'none';
  root.appendChild(overlay);

  // Inset width = the CSS `padding-left` on `.monaco-editor`, measured as the
  // overflow-guard's on-screen offset from the root (same technique the line-
  // number glow uses). Monaco's current-line band starts at the guard's left edge,
  // so this strip fills exactly `[0, inset)` to bridge it to the window edge.
  const insetWidth = (): number => {
    const guard = root.querySelector('.overflow-guard');
    return guard
      ? guard.getBoundingClientRect().left - root.getBoundingClientRect().left
      : 0;
  };

  let rafId: number | null = null;
  const render = (): void => {
    rafId = null;
    const pos = editor.getPosition();
    const sel = editor.getSelection();
    // Monaco hides the current-line highlight while a non-empty selection is
    // active; mirror that so the strip never lingers without a matching band.
    if (!pos || (sel && !sel.isEmpty())) {
      overlay.style.display = 'none';
      return;
    }
    const line = pos.lineNumber;
    // Viewport-relative top of the active model line, and its full height (covers
    // every wrapped visual row, since the next line's top sits after them). Both
    // are in the root's padding-box coordinate space (Monaco's content top = 0).
    const top = editor.getTopForLineNumber(line) - editor.getScrollTop();
    const height = editor.getTopForLineNumber(line + 1) - editor.getTopForLineNumber(line);
    const width = insetWidth();
    if (width <= 0 || height <= 0) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.top = `${top}px`;
    overlay.style.height = `${height}px`;
    overlay.style.width = `${width}px`;
    overlay.style.display = 'block';
  };
  const schedule = (): void => {
    if (rafId == null) rafId = requestAnimationFrame(render);
  };
  schedule();

  const selSub = editor.onDidChangeCursorSelection(schedule);
  const scrollSub = editor.onDidScrollChange(schedule);
  const layoutSub = editor.onDidLayoutChange(schedule);

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    selSub.dispose();
    scrollSub.dispose();
    layoutSub.dispose();
    overlay.remove();
  };
}
