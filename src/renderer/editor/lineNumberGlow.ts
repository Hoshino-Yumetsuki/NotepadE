/**
 * ============================================================================
 *  Line-number Reveal glow — cursor-proximity edge highlight on the CM6 gutter
 * ============================================================================
 *
 * A faithful re-creation of the Fluent **Reveal border brush** the UWP Notepads
 * editor put on its line-number column. In `TextEditorCore.xaml:94-97` the
 * `LineNumberGrid` carries
 *   BorderBrush="{ThemeResource SystemControlBackgroundTransparentRevealBorderBrush}"
 * — an OS reveal brush that lights a soft radial glow along the column's
 * edge/separator as the pointer approaches, brightest under the cursor and
 * fading with distance. notepads-next' CM6 gutter had no such glow; this module
 * adds it on the gutter's right edge (the line-number / text separator).
 *
 * Self-contained on purpose: this is the editor's own glow and deliberately does
 * NOT import `theme/reveal.ts` (a different worker's lane). It re-uses the SAME
 * perf discipline as that module though:
 *   - the gutter rect is sampled ONCE on pointerenter and reused for every move
 *     (never getBoundingClientRect per pixel — that forces sync layout reflow),
 *   - pointer updates are coalesced into a single requestAnimationFrame so many
 *     moves per frame collapse to one style mutation,
 *   - only CSS custom properties + `opacity` are written (no layout-triggering
 *     props, no per-frame React state) so the glow stays on the compositor.
 *
 * THEME: light/dark/hc aware and tinted with the resolved app accent. HC and the
 * `prefers-reduced-transparency` / `prefers-reduced-motion` users get NO glow
 * (the plugin stays fully inert — no overlay, no listeners), matching UWP, which
 * drops reveal material under forced-colors / reduced-effects.
 *
 * CRITICAL: this does NOT register an `EditorView.theme()` selector. CM6's theme
 * builder throws `RangeError: Unsupported selector` on `&dark`-style ancestor
 * selectors (the prior crash). All styling here lives on a plain inline-styled
 * overlay element, so there is no selector for CM6 to reject.
 *
 * PA-8: pure renderer data + DOM-only pointer tracking. No fs/path/child_process,
 * no IPC bridge access.
 */

import { ViewPlugin, type PluginValue, type ViewUpdate, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

// ---------------------------------------------------------------------------
//  Geometry + CSS-var contract
// ---------------------------------------------------------------------------

/**
 * Radius of the edge bloom in CSS px. The Fluent reveal BORDER brush is a tight
 * edge-light, not a wide blob — kept small so the glow hugs the gutter's right
 * separator rather than washing the whole column.
 */
export const GLOW_RADIUS_PX = 60;
/**
 * Horizontal falloff in px: glow is full while the pointer is over the gutter and
 * ramps to zero this many px to the RIGHT of the gutter's separator edge, so it
 * "intensifies as the cursor nears the left margin" exactly like the UWP brush.
 */
export const GLOW_FALLOFF_PX = 60;

/** Pointer Y within the (sticky) gutter box, in px from its top edge. */
export const GLOW_VAR_Y = '--ln-glow-y';
/** 0..1 glow intensity (0 at rest / far right, 1 while over the gutter). */
export const GLOW_VAR_OPACITY = '--ln-glow-opacity';

/** Options threaded from the host so the glow matches the live theme + accent. */
export interface LineNumberGlowOptions {
  /** Resolved theme bucket — picks tint alpha; `hc` disables the glow. */
  themeMode: 'light' | 'dark' | 'hc';
  /** Resolved app accent (#RRGGBB) the glow is tinted with. */
  accentColor: string;
}

// ---------------------------------------------------------------------------
//  Pure helpers (unit-tested without a DOM)
// ---------------------------------------------------------------------------

/** Parse a `#RGB` / `#RRGGBB` color into 8-bit channels, or null if unparseable. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * The glow tint for a theme bucket. UWP's `SystemControlBackgroundTransparent‐
 * RevealBorderBrush` is a NEUTRAL reveal-border light (a soft white-ish bloom on
 * dark, black-ish on light) — it is NOT tinted with the app accent. We keep the
 * `accentColor` parameter only for API stability; it is intentionally unused so
 * the glow reads as the OS edge-light rather than a colored blob. HC returns
 * `transparent` — reveal material is inert under forced-colors.
 */
export function glowColor(themeMode: 'light' | 'dark' | 'hc', _accentColor: string): string {
  if (themeMode === 'hc') return 'transparent';
  // Neutral edge-light: a faint white bloom on dark, a faint black bloom on light.
  return themeMode === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.14)';
}

/**
 * Glow intensity (0..1) for a pointer that is `distanceRightOfEdge` px to the
 * right of the gutter's separator edge. Negative/zero distance (pointer over the
 * gutter) is full intensity; it ramps linearly to 0 by `falloff`.
 */
export function glowOpacityForDistance(
  distanceRightOfEdge: number,
  falloff = GLOW_FALLOFF_PX,
): number {
  if (distanceRightOfEdge <= 0) return 1;
  if (distanceRightOfEdge >= falloff) return 0;
  return 1 - distanceRightOfEdge / falloff;
}

/**
 * True when the environment asks us to suppress the glow: reduced transparency or
 * reduced motion. Guards `matchMedia` so jsdom / SSR (no matchMedia) is safe and
 * simply treats the glow as enabled.
 */
export function glowDisabledByMedia(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return (
    (window.matchMedia('(prefers-reduced-transparency: reduce)').matches ?? false) ||
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

/** The radial-gradient `background` value for the overlay (centered on the right edge). */
export function glowBackground(color: string): string {
  return (
    `radial-gradient(circle ${GLOW_RADIUS_PX}px at 100% ` +
    `var(${GLOW_VAR_Y}, -9999px), ${color} 0%, transparent 70%)`
  );
}

// ---------------------------------------------------------------------------
//  The ViewPlugin
// ---------------------------------------------------------------------------

/**
 * Build the line-number glow extension. Mount it ALONGSIDE `lineNumbers()` (gate
 * on the same prop) so the glow only exists while the gutter does. Re-create it
 * (via a Compartment.reconfigure) when `themeMode` / `accentColor` change — those
 * are infrequent (a settings/theme switch), so rebuilding the cheap plugin is
 * fine and keeps the per-pointer path free of facet reads.
 */
export function lineNumberGlow(options: LineNumberGlowOptions): Extension {
  const color = glowColor(options.themeMode, options.accentColor);
  const motionless = glowDisabledByMedia();
  // Inert path: HC / reduced-transparency / reduced-motion → no overlay, no
  // listeners, nothing to clean up. The gutter renders exactly as before.
  const disabled = motionless || color === 'transparent';

  return ViewPlugin.define((view) => new LineNumberGlowPlugin(view, color, disabled));
}

class LineNumberGlowPlugin implements PluginValue {
  private overlay: HTMLDivElement | null = null;
  /** Sampled once on pointerenter; reused for every move (no per-pixel reflow). */
  private rect: { top: number; right: number } | null = null;
  private rafId: number | null = null;
  private next: { y: number; opacity: number } | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly color: string,
    private readonly disabled: boolean,
  ) {
    if (this.disabled) return;
    this.onEnter = this.onEnter.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.flush = this.flush.bind(this);
    this.mountOverlay();
    // Listen on the scroll element: it contains BOTH the gutters and the content,
    // so a pointer over the line-number column is covered and we can measure its
    // distance from the gutter's right edge as it moves into the text.
    const scroller = view.scrollDOM;
    scroller.addEventListener('pointerenter', this.onEnter, { passive: true });
    scroller.addEventListener('pointermove', this.onMove, { passive: true });
    scroller.addEventListener('pointerleave', this.onLeave, { passive: true });
  }

  /** The line-number column element, looked up lazily (exists once it mounts). */
  private gutters(): HTMLElement | null {
    return this.view.dom.querySelector<HTMLElement>('.cm-lineNumberColumn');
  }

  private mountOverlay(): void {
    const gutters = this.gutters();
    if (!gutters) return; // retried on the next update()
    // `.cm-lineNumberColumn` is position: absolute, which establishes a containing
    // block for this absolutely-positioned child, so inset:0 fills the column box.
    const el = document.createElement('div');
    el.className = 'cm-lineNumberGlow';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '1';
    el.style.opacity = `var(${GLOW_VAR_OPACITY}, 0)`;
    el.style.background = glowBackground(this.color);
    // Opacity-only transition keeps the fade on the compositor. (Reduced-motion
    // users never reach here — the whole plugin is inert for them.)
    el.style.transition = 'opacity 120ms ease-out';
    el.style.willChange = 'opacity';
    gutters.appendChild(el);
    this.overlay = el;
  }

  update(_update: ViewUpdate): void {
    if (this.disabled) return;
    // The line-number column can rebuild its DOM (e.g. on a theme/font reconfigure),
    // detaching our overlay. Re-attach it cheaply when that happens.
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
    el.style.setProperty(GLOW_VAR_Y, `${n.y}px`);
    el.style.setProperty(GLOW_VAR_OPACITY, `${n.opacity}`);
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
  }
}
