/**
 * Line-number reveal glow (RENDERER, Monaco port).
 *
 * A thin vertical highlight rendered AT the boundary between the line-number
 * column and the editor text area. It is solid in the center and fades vertically
 * at both ends, following the pointer's Y as it moves near the boundary, and
 * fades out horizontally as the pointer moves right into the content.
 *
 * Monaco port of the original CM6 plugin (deleted in the migration). Same visual
 * contract; geometry now reads `editor.getLayoutInfo().contentLeft` for the
 * boundary x and `editor.getDomNode()` as the positioning/clipping root.
 *
 * Perf discipline (mirrors the CM6 original):
 *   - the editor rect is sampled ONCE on pointerenter and reused for every move
 *   - pointer updates are coalesced into a single requestAnimationFrame
 *   - only CSS `opacity`, `top`, `height`, `left` are written
 *   - `transition: opacity` only — no transition on layout-triggering props
 *
 * THEME: light/dark/hc aware. HC and prefers-reduced-transparency/motion users
 * get NO glow (the attach is fully inert and returns a no-op disposer).
 *
 * PA-8: pure renderer data + DOM-only pointer tracking.
 */

import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/** Width of the thin vertical line at the boundary (px). */
export const GLOW_LINE_WIDTH = 2;
/** Vertical band height around the cursor (px above + below). */
export const GLOW_BAND_HALF = 60;
/** Horizontal falloff: full at the boundary, zero this many px to the RIGHT. */
export const GLOW_FALLOFF_PX = 80;

export interface LineNumberGlowOptions {
  themeMode: 'light' | 'dark' | 'hc';
  accentColor: string;
}

/** Glow color per theme (HC → none). Accent intentionally unused (neutral glow). */
export function glowColor(themeMode: 'light' | 'dark' | 'hc'): string {
  if (themeMode === 'hc') return 'transparent';
  return themeMode === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.14)';
}

/** Opacity ramp: 1 at/left-of the boundary, linearly to 0 by `falloff` px right. */
export function glowOpacityForDistance(
  distanceRightOfEdge: number,
  falloff = GLOW_FALLOFF_PX
): number {
  if (distanceRightOfEdge <= 0) return 1;
  if (distanceRightOfEdge >= falloff) return 0;
  return 1 - distanceRightOfEdge / falloff;
}

/** True when the OS asks for reduced transparency/motion — the glow stays off. */
export function glowDisabledByMedia(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    window.matchMedia('(prefers-reduced-transparency: reduce)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Vertical gradient: solid in the center, fading to transparent at top + bottom. */
export function glowBackground(color: string): string {
  return `linear-gradient(to bottom, transparent 0%, ${color} 40%, ${color} 60%, transparent 100%)`;
}

/**
 * Attach the reveal glow to a live Monaco editor. Returns a disposer that removes
 * the overlay + all listeners. Inert (no-op disposer) for HC / reduced-motion.
 */
export function attachLineNumberGlow(
  editor: monaco.editor.IStandaloneCodeEditor,
  options: LineNumberGlowOptions
): () => void {
  const color = glowColor(options.themeMode);
  const root = editor.getDomNode();
  if (color === 'transparent' || glowDisabledByMedia() || !root) return () => {};

  const overlay = document.createElement('div');
  overlay.className = 'monaco-lineNumberGlow';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'absolute';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '3';
  overlay.style.width = `${GLOW_LINE_WIDTH}px`;
  overlay.style.top = '0';
  overlay.style.height = '0';
  overlay.style.opacity = '0';
  overlay.style.background = glowBackground(color);
  overlay.style.transition = 'opacity 120ms ease-out';
  overlay.style.willChange = 'opacity';

  // Boundary x = where content begins (right edge of the gutter), in px from the
  // editor's left edge. Kept in sync on layout change (line-number toggle/resize).
  let boundaryX = editor.getLayoutInfo().contentLeft;
  const positionLeft = (): void => {
    overlay.style.left = `${Math.max(0, boundaryX - GLOW_LINE_WIDTH / 2)}px`;
  };
  positionLeft();
  root.appendChild(overlay);

  let rafId: number | null = null;
  let next: { y: number; opacity: number } | null = null;
  // Editor rect sampled on pointerenter and reused for the move burst (perf).
  let rect: { top: number; left: number } | null = null;

  const flush = (): void => {
    rafId = null;
    if (!next) return;
    const maxH = editor.getLayoutInfo().height;
    const bandH = maxH > 0 ? Math.min(GLOW_BAND_HALF * 2, maxH) : GLOW_BAND_HALF * 2;
    const rawTop = next.y - bandH / 2;
    const top = maxH > 0 ? Math.max(0, Math.min(rawTop, maxH - bandH)) : Math.max(0, rawTop);
    overlay.style.top = `${top}px`;
    overlay.style.height = `${bandH}px`;
    overlay.style.opacity = `${next.opacity}`;
  };
  const write = (y: number, opacity: number): void => {
    next = { y, opacity };
    if (rafId == null) rafId = requestAnimationFrame(flush);
  };

  const onEnter = (e: PointerEvent): void => {
    const r = root.getBoundingClientRect();
    rect = { top: r.top, left: r.left };
    onMove(e);
  };
  const onMove = (e: PointerEvent): void => {
    if (!rect) return;
    const y = e.clientY - rect.top;
    const opacity = glowOpacityForDistance(e.clientX - (rect.left + boundaryX));
    write(y, opacity);
  };
  const onLeave = (): void => write(0, 0);

  root.addEventListener('pointerenter', onEnter, { passive: true });
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave, { passive: true });
  const layoutSub = editor.onDidLayoutChange((info) => {
    boundaryX = info.contentLeft;
    positionLeft();
  });

  return () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    root.removeEventListener('pointerenter', onEnter);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
    layoutSub.dispose();
    overlay.remove();
  };
}
