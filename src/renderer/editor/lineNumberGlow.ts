/**
 * ============================================================================
 *  Line-number Reveal glow — vertical boundary line between gutter and content
 * ============================================================================
 *
 * A vertical highlight line rendered AT the boundary between the line-number
 * column and the editor text area. The line is solid in the center and fades
 * horizontally on both sides (into the gutter and into the content), following
 * the cursor vertically as the pointer moves near the boundary.
 *
 * Self-contained on purpose: this is the editor's own glow and deliberately does
 * NOT import `theme/reveal.ts` (a different worker's lane).
 *
 * Perf discipline:
 *   - the gutter rect is sampled ONCE on pointerenter and reused for every move
 *   - pointer updates are coalesced into a single requestAnimationFrame
 *   - only CSS `opacity`, `top`, `height`, `left`, `width` are written
 *   - `transition: opacity` only — no transition on layout-triggering props
 *
 * THEME: light/dark/hc aware. HC and prefers-reduced-transparency/motion users
 * get NO glow (plugin stays fully inert).
 *
 * PA-8: pure renderer data + DOM-only pointer tracking.
 */

import { ViewPlugin, type PluginValue, type ViewUpdate, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

// ---------------------------------------------------------------------------
//  Geometry + CSS contract
// ---------------------------------------------------------------------------

/** Width of the thin vertical line at the boundary (px). */
export const GLOW_LINE_WIDTH = 2;
/** Vertical band height around the cursor (px above + below). */
export const GLOW_BAND_HALF = 60;
/**
 * Horizontal falloff: glow is full while the pointer is over the gutter edge and
 * ramps to zero this many px to the RIGHT of the boundary.
 */
export const GLOW_FALLOFF_PX = 80;

/** Options threaded from the host. */
export interface LineNumberGlowOptions {
  themeMode: 'light' | 'dark' | 'hc';
  accentColor: string;
}

// ---------------------------------------------------------------------------
//  Pure helpers
// ---------------------------------------------------------------------------

export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function glowColor(themeMode: 'light' | 'dark' | 'hc', _accentColor: string): string {
  if (themeMode === 'hc') return 'transparent';
  return themeMode === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.14)';
}

export function glowOpacityForDistance(
  distanceRightOfEdge: number,
  falloff = GLOW_FALLOFF_PX
): number {
  if (distanceRightOfEdge <= 0) return 1;
  if (distanceRightOfEdge >= falloff) return 0;
  return 1 - distanceRightOfEdge / falloff;
}

export function glowDisabledByMedia(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    (window.matchMedia('(prefers-reduced-transparency: reduce)').matches ?? false) ||
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

/**
 * Vertical gradient for the line: solid color in the center, fading to
 * transparent at both top and bottom ends.
 */
export function glowBackground(color: string): string {
  return (
    `linear-gradient(to bottom,` +
    ` transparent 0%,` +
    ` ${color} 40%,` +
    ` ${color} 60%,` +
    ` transparent 100%)`
  );
}

// ---------------------------------------------------------------------------
//  The ViewPlugin
// ---------------------------------------------------------------------------

export function lineNumberGlow(options: LineNumberGlowOptions): Extension {
  const color = glowColor(options.themeMode, options.accentColor);
  const motionless = glowDisabledByMedia();
  const disabled = motionless || color === 'transparent';

  return ViewPlugin.define((view) => new LineNumberGlowPlugin(view, color, disabled));
}

class LineNumberGlowPlugin implements PluginValue {
  private overlay: HTMLDivElement | null = null;
  private rect: { top: number; right: number } | null = null;
  private rafId: number | null = null;
  private next: { y: number; opacity: number } | null = null;
  private colWidth = 0;

  constructor(
    private readonly view: EditorView,
    private readonly color: string,
    private readonly disabled: boolean
  ) {
    if (this.disabled) return;
    this.onEnter = this.onEnter.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.flush = this.flush.bind(this);
    this.mountOverlay();
    const scroller = view.scrollDOM;
    scroller.addEventListener('pointerenter', this.onEnter, { passive: true });
    scroller.addEventListener('pointermove', this.onMove, { passive: true });
    scroller.addEventListener('pointerleave', this.onLeave, { passive: true });
  }

  private gutters(): HTMLElement | null {
    // The native CM6 gutter (lineNumberColumn.ts mounts lineNumbers() now). It
    // lives inside .cm-scroller, sticky at the left edge — its right edge is the
    // boundary this glow lights.
    return this.view.dom.querySelector<HTMLElement>('.cm-gutters');
  }

  private mountOverlay(): void {
    const gutters = this.gutters();
    if (!gutters) return;
    const colRect = gutters.getBoundingClientRect();
    this.colWidth = colRect.width;

    const el = document.createElement('div');
    el.className = 'cm-lineNumberGlow';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1';
    // 2px line centered at the boundary: 1px on each side.
    el.style.left = `${Math.max(0, this.colWidth - 1)}px`;
    el.style.width = `${GLOW_LINE_WIDTH}px`;
    el.style.top = '0';
    el.style.height = '0';
    el.style.opacity = '0';
    el.style.background = glowBackground(this.color);
    el.style.transition = 'opacity 120ms ease-out';
    el.style.willChange = 'opacity';
    // Clip the overlay to view.dom so the glow never bleeds into surrounding UI.
    this.view.dom.style.overflow = 'hidden';
    this.view.dom.appendChild(el);
    this.overlay = el;
  }

  update(_update: ViewUpdate): void {
    if (this.disabled) return;
    // The column DOM may rebuild on theme/font changes; re-read column width.
    const gutters = this.gutters();
    if (gutters) {
      const w = gutters.getBoundingClientRect().width;
      if (w !== this.colWidth) {
        this.colWidth = w;
        if (this.overlay) {
          this.overlay.style.left = `${Math.max(0, w - 1)}px`;
        }
      }
    }
    if (!this.overlay || !this.overlay.isConnected) {
      this.overlay = null;
      this.mountOverlay();
    }
  }

  private onEnter(e: PointerEvent): void {
    const gutters = this.gutters();
    if (gutters) {
      const r = gutters.getBoundingClientRect();
      this.rect = { top: r.top, right: r.right };
    }
    this.onMove(e);
  }

  private onMove(e: PointerEvent): void {
    const rect = this.rect;
    if (!rect) return;
    const y = e.clientY - rect.top;
    const opacity = glowOpacityForDistance(e.clientX - rect.right);
    this.write(y, opacity);
  }

  private onLeave(): void {
    this.write(0, 0);
  }

  private write(y: number, opacity: number): void {
    this.next = { y, opacity };
    if (this.rafId == null) this.rafId = requestAnimationFrame(this.flush);
  }

  private flush(): void {
    this.rafId = null;
    const el = this.overlay;
    const n = this.next;
    if (!el || !n) return;
    const maxH = this.view.scrollDOM.clientHeight;
    // Clamp within the editor viewport: never let the glow bleed above or below.
    const bandH = maxH > 0 ? Math.min(GLOW_BAND_HALF * 2, maxH) : GLOW_BAND_HALF * 2;
    const rawTop = n.y - bandH / 2;
    const top = maxH > 0 ? Math.max(0, Math.min(rawTop, maxH - bandH)) : Math.max(0, rawTop);
    el.style.top = `${top}px`;
    el.style.height = `${bandH}px`;
    el.style.opacity = `${n.opacity}`;
  }

  destroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (!this.disabled) {
      const scroller = this.view.scrollDOM;
      scroller.removeEventListener('pointerenter', this.onEnter);
      scroller.removeEventListener('pointermove', this.onMove);
      scroller.removeEventListener('pointerleave', this.onLeave);
    }
    this.overlay?.remove();
    this.overlay = null;
    this.view.dom.style.overflow = '';
  }
}
