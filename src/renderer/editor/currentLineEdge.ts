/**
 * Current-line highlight (RENDERER, Monaco port) — fully manual.
 *
 * Monaco's native `renderLineHighlight` band is painted INSIDE `.overflow-guard`
 * (`overflow:hidden`), which starts at the content-box left — i.e. AFTER the CSS
 * `padding-left` inset on `.monaco-editor`. So the native band can never reach
 * into the padding strip: the gray stops short of the window's left edge, leaving
 * a visible gap. A small filler strip in `[0, inset)` bridges the gap but leaves a
 * seam where it meets Monaco's band (two layers compositing over acrylic at
 * slightly different boundaries) — the "缺了一块" the user reported.
 *
 * The robust fix is to draw the WHOLE current-line band ourselves as ONE piece,
 * and disable Monaco's native band (see MonacoEditor: renderLineHighlight 'none').
 * This overlay is a single full-width strip appended to the editor ROOT (which is
 * `overflow:visible` and spans the full padding box), painted behind Monaco's
 * transparent content layers (`z-index:-1` + `isolation:isolate` on the root) so
 * line numbers and text render on top. It tracks the active line's Y and spans
 * `[0, clientWidth)` — continuous from the window's left edge, across the gutter,
 * through the text, to the right edge. No seam, no missing chunk.
 *
 * THEME: light/dark aware, matching the old `editor.lineHighlightBackground`
 * token exactly. HC paints no line highlight → the attach is inert (no-op
 * disposer).
 *
 * Perf: only `top`/`height`/`width`/`opacity` are written synchronously on each
 * cursor/scroll/layout event — no rAF deferral, so the band never lags Monaco.
 *
 * PA-8: pure renderer data + DOM-only positioning.
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface CurrentLineEdgeOptions {
  themeMode: 'light' | 'dark' | 'hc';
}

/**
 * Current-line band color per theme. These match the Monaco theme tokens that
 * `renderLineHighlight` used to paint (`editor.lineHighlightBackground`): light
 * `#7f7f7f14`, dark `#ffffff0d`. The band composites over the same transparent
 * acrylic surface as the text, so the resulting shade is identical to the old
 * native band. HC paints no line highlight → 'transparent' (attach is a no-op).
 */
export function currentLineEdgeColor(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'transparent';
  return themeMode === 'dark' ? '#ffffff0d' : '#7f7f7f14';
}

/**
 * Attach the manual current-line highlight to a live Monaco editor. Returns a
 * disposer that removes the overlay + all listeners. Inert (no-op disposer) for
 * HC or when the editor has no DOM node yet.
 */
export function attachCurrentLineEdge(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: CurrentLineEdgeOptions
): () => void {
  const color = currentLineEdgeColor(options.themeMode);
  const root = editor.getDomNode();
  if (color === 'transparent' || !root) return () => {};

  // The root must be its own stacking context so the `z-index:-1` band paints
  // BEHIND Monaco's (transparent) content layers but still IN FRONT of the root's
  // background — not behind the window. Monaco sets the root position:relative;
  // isolation:isolate pins the context without affecting layout.
  const prevIsolation = root.style.isolation;
  root.style.isolation = 'isolate';

  const overlay = document.createElement('div');
  overlay.className = 'monaco-currentLineEdge';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '0';
  overlay.style.height = '0';
  overlay.style.pointerEvents = 'none';
  // Back-most layer: behind Monaco's transparent content (line numbers/text render
  // on top), in front of the root's gutter-wash background.
  overlay.style.zIndex = '-1';
  // GPU-promote the band so it composites the SAME way Monaco's native current-line
  // band did (Monaco paints it inside transformed/promoted scroll layers). A
  // non-promoted div instead blends WITH the window vibrancy/acrylic, yielding a
  // visibly different shade than the native band — the color mismatch the user saw.
  // translateZ(0) is applied dynamically by show() and removed by hide() so the
  // invisible overlay never holds a GPU layer that could interfere with Monaco's
  // selection compositing on the transparent surface.
  overlay.style.transform = 'none';
  overlay.style.background = color;
  overlay.style.opacity = '0';
  root.appendChild(overlay);

  let visible = false;
  const hide = (): void => {
    if (!visible) return;
    visible = false;
    overlay.style.opacity = '0';
    overlay.style.visibility = 'hidden';
    overlay.style.transform = 'none';
  };
  const show = (): void => {
    if (!visible) {
      visible = true;
      overlay.style.transform = 'translateZ(0)';
    }
  };
  const render = (): void => {
    const pos = editor.getPosition();
    const sel = editor.getSelection();
    if (!pos || (sel && !sel.isEmpty())) {
      hide();
      return;
    }
    const line = pos.lineNumber;
    const scrollTop = editor.getScrollTop();
    let top = editor.getTopForLineNumber(line) - scrollTop;
    let height = editor.getBottomForLineNumber(line) - editor.getTopForLineNumber(line);
    const viewportH = root.clientHeight;
    if (top < 0) {
      height += top;
      top = 0;
    }
    if (height > viewportH - top) height = viewportH - top;
    const width = root.clientWidth;
    if (width <= 0 || height <= 0 || top >= viewportH) {
      hide();
      return;
    }
    show();
    overlay.style.top = `${top}px`;
    overlay.style.height = `${height}px`;
    overlay.style.width = `${width}px`;
    overlay.style.visibility = 'visible';
    overlay.style.opacity = '1';
  };
  render();

  const selSub = editor.onDidChangeCursorSelection(render);
  const scrollSub = editor.onDidScrollChange(render);
  const layoutSub = editor.onDidLayoutChange(render);

  return () => {
    selSub.dispose();
    scrollSub.dispose();
    layoutSub.dispose();
    overlay.remove();
    root.style.isolation = prevIsolation;
  };
}
