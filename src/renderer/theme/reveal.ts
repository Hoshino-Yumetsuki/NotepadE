/**
 * ============================================================================
 *  Reveal brush — cursor-follow radial highlight (Phase 7, Stream C, Task #27)
 * ============================================================================
 *
 * A faithful re-creation of the WinUI/UWP Fluent *RevealBrush* the shipping
 * Notepads chrome inherits implicitly from the OS control styles:
 *   - SetsViewItem  (tab headers)       → RevealBackground / RevealBorder
 *   - the StatusBar Buttons             → SystemControlHighlightListLow + reveal
 *   - the caption / title-bar buttons   → RevealBackgroundBrush
 *
 * UWP never names "Reveal" in this repo's XAML because it is an OS theme
 * resource: any `ListViewItemRevealStyle` / `ButtonRevealStyle` surface gets a
 * radial highlight that FOLLOWS THE POINTER (RevealBrushHelper feeds the cursor
 * position into the brush), brightening the area under the cursor and softly
 * lighting the surface edges on hover. The Phase 2/4 chrome already encodes the
 * flat hover-overlay greys (SystemRevealListLowColor) in tabs/tokens.ts and
 * statusbar/tokens.ts; THIS module adds the cursor-follow radial layer on top.
 *
 * Per-theme tokens are grounded on the same overlay families as the existing
 * chrome (white-on-dark, black-on-light, forced-colors Highlight for HC) so the
 * reveal reads as one continuous Fluent material with the rest of the app.
 *
 * GOLDEN-SAFE: the radial highlight only paints while a pointer is genuinely
 * inside the surface (opacity 0 at rest), exactly like the existing
 * onMouseEnter hover overlays. The visual-golden captures (tabs-visual /
 * statusbar-visual) never move the mouse over a cell before the screenshot, so
 * this layer contributes nothing to the baselines.
 *
 * PA-8: pure renderer data + DOM-only pointer tracking. No fs/path/child_process,
 * no IPC bridge access.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { AppTheme } from './tokens';

// ---------------------------------------------------------------------------
//  Per-theme reveal tokens
// ---------------------------------------------------------------------------

/** The two radial-highlight tints + geometry a reveal surface paints. */
export interface RevealTokens {
  /**
   * Inner-most highlight color at the exact cursor point (Fluent
   * RevealHoverColor). Strongest, fades to transparent by `radius`.
   */
  hoverColor: string;
  /**
   * Pressed-state highlight color (Fluent RevealPressedColor) — a touch
   * brighter than hover, used while the surface is actively pressed.
   */
  pressedColor: string;
  /** Radius of the radial highlight in CSS px (Fluent default ~108px). */
  radius: number;
}

/**
 * Light theme — base #F0F0F0. Fluent light reveal layers a low-alpha BLACK
 * highlight (SystemRevealListLowColor light = #00000010-ish ramp); the cursor
 * point is darkened slightly relative to the flat hover grey already painted.
 */
export const LIGHT_REVEAL_TOKENS: RevealTokens = {
  hoverColor: 'rgba(0, 0, 0, 0.06)',
  pressedColor: 'rgba(0, 0, 0, 0.10)',
  radius: 108,
};

/**
 * Dark theme — base #2E2E2E. Fluent dark reveal layers a low-alpha WHITE
 * highlight (SystemRevealListLowColor dark), brightening the cursor point.
 */
export const DARK_REVEAL_TOKENS: RevealTokens = {
  hoverColor: 'rgba(255, 255, 255, 0.08)',
  pressedColor: 'rgba(255, 255, 255, 0.12)',
  radius: 108,
};

/**
 * High Contrast — forced-colors. Reveal/elevation layering is disabled in HC
 * (the OS paints flat system colors with no material), so both tints collapse
 * to transparent. The surface still shows its flat Highlight hover from the
 * chrome tokens; this radial layer is simply inert, matching UWP HC.
 */
export const HC_REVEAL_TOKENS: RevealTokens = {
  hoverColor: 'transparent',
  pressedColor: 'transparent',
  radius: 108,
};

/** Resolve the reveal token set for an app theme bucket. */
export function tokensForReveal(theme: AppTheme): RevealTokens {
  switch (theme) {
    case 'hc':
      return HC_REVEAL_TOKENS;
    case 'dark':
      return DARK_REVEAL_TOKENS;
    case 'light':
      return LIGHT_REVEAL_TOKENS;
  }
}

// ---------------------------------------------------------------------------
//  CSS custom-property contract (consumed by RevealLayer's gradient)
// ---------------------------------------------------------------------------

/** Cursor X within the surface, in px from its left edge. */
export const REVEAL_VAR_X = '--reveal-x';
/** Cursor Y within the surface, in px from its top edge. */
export const REVEAL_VAR_Y = '--reveal-y';
/** 0..1 highlight intensity (0 at rest, 1 while the pointer is inside). */
export const REVEAL_VAR_OPACITY = '--reveal-opacity';

// ---------------------------------------------------------------------------
//  useReveal — pointer tracking that writes the CSS vars on a host element
// ---------------------------------------------------------------------------

/** Handlers a reveal host spreads onto its root element. */
export interface RevealHandlers {
  onPointerMove(e: React.PointerEvent<HTMLElement>): void;
  onPointerEnter(e: React.PointerEvent<HTMLElement>): void;
  onPointerLeave(): void;
}

/**
 * Track the pointer over a host element and expose its position + a 0/1 opacity
 * as CSS custom properties on that element. Writing the vars directly on the DOM
 * node (not React state) keeps the follow at pointer-event rate with zero
 * re-renders — the same approach RevealBrushHelper uses (it feeds the composition
 * brush, not the layout tree).
 *
 * Usage:
 *   const { hostRef, handlers } = useReveal();
 *   <div ref={hostRef} {...handlers} style={{ position: 'relative' }}>
 *     <RevealLayer tokens={tokensForReveal(theme)} />
 *     ...content...
 *   </div>
 */
export function useReveal(): {
  hostRef: React.RefObject<HTMLElement>;
  handlers: RevealHandlers;
} {
  const hostRef = useRef<HTMLElement>(null);
  // Rect sampled ONCE on enter and reused for every move (the surface doesn't
  // resize mid-hover) so the pointer-rate path never calls getBoundingClientRect
  // — that read forced a synchronous layout reflow on every pixel of movement,
  // the dominant reveal jank source. Var writes are coalesced into one rAF so
  // many moves per frame collapse to a single style mutation.
  const rectRef = useRef<{ left: number; top: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const nextRef = useRef<{ x: number; y: number; opacity: number } | null>(null);

  const flush = useCallback((): void => {
    rafRef.current = null;
    const el = hostRef.current;
    const n = nextRef.current;
    if (!el || !n) return;
    el.style.setProperty(REVEAL_VAR_X, `${n.x}px`);
    el.style.setProperty(REVEAL_VAR_Y, `${n.y}px`);
    el.style.setProperty(REVEAL_VAR_OPACITY, `${n.opacity}`);
  }, []);

  const write = useCallback(
    (x: number, y: number, opacity: number): void => {
      nextRef.current = { x, y, opacity };
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const fromEvent = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const rect = rectRef.current;
      if (!rect) return;
      write(e.clientX - rect.left, e.clientY - rect.top, 1);
    },
    [write],
  );

  const onPointerEnter = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const el = hostRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        rectRef.current = { left: r.left, top: r.top };
      }
      fromEvent(e);
    },
    [fromEvent],
  );
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => fromEvent(e), [fromEvent]);
  const onPointerLeave = useCallback(() => write(0, 0, 0), [write]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { hostRef, handlers: { onPointerMove, onPointerEnter, onPointerLeave } };
}

// ---------------------------------------------------------------------------
//  Reveal radial-gradient background value (for a RevealLayer element)
// ---------------------------------------------------------------------------

/**
 * Build the `background` value for a reveal layer: a radial-gradient centered on
 * the tracked cursor vars, fading the hover tint to transparent by `radius`. The
 * layer's own `opacity` is driven by REVEAL_VAR_OPACITY so it disappears at rest.
 */
export function revealGradient(tokens: RevealTokens): string {
  return (
    `radial-gradient(circle ${tokens.radius}px ` +
    `at var(${REVEAL_VAR_X}, -9999px) var(${REVEAL_VAR_Y}, -9999px), ` +
    `${tokens.hoverColor} 0%, transparent 100%)`
  );
}
