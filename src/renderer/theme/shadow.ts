/**
 * ============================================================================
 *  Edge-shadow / elevation system (Phase 7, Task #28)
 * ============================================================================
 *
 * The UWP SetsView paints an EDGE SHADOW around the tab strip (and the chrome
 * surfaces it elevates) whose opacity ramps per theme. That opacity ramp is the
 * authoritative 1:1 value already captured in theme/tokens.ts
 * (AppThemeTokens.tabEdgeShadowOpacity): Light 0.55 / Dark 0.7 / HC 0.0
 * (EdgeShadowOpacity 0 in high-contrast — no elevation material).
 *
 * RENDERING MODEL: rather than a CSS `box-shadow` on the strip/bar themselves
 * (whose blur bleeds back INTO the element's own box and would shift the Gate-2/
 * Gate-4 golden captures that clip exactly that box), the elevation is rendered
 * as a thin GRADIENT CASTER element mounted just OUTSIDE the chrome box — below
 * the tab strip and above the status bar. The caster fades the edge-shadow color
 * to transparent over an 8-10px band, reading as a soft drop shadow onto the
 * editor surface, while leaving the strip/bar golden boxes pixel-identical.
 *
 * HC: opacity 0 → the caster collapses to nothing (height 0 / transparent),
 * matching UWP's flat high-contrast chrome.
 *
 * PA-8: pure data. No fs/path/child_process, no IPC.
 */

import type { CSSProperties } from 'react';
import { tokensForAppTheme, type AppTheme } from './tokens';

/** Fluent-ish elevation blur band for chrome edges (task spec: 8-10px). */
export const EDGE_SHADOW_BLUR = 9;

/** The shadow color is always black; only its alpha (the edge opacity) varies. */
function shadowColor(opacity: number): string {
  return `rgba(0, 0, 0, ${opacity})`;
}

/**
 * The per-theme edge-shadow opacity (UWP EdgeShadowOpacity). Re-exported from the
 * app chrome tokens so callers don't reach into two modules.
 */
export function edgeShadowOpacity(theme: AppTheme): number {
  return tokensForAppTheme(theme).tabEdgeShadowOpacity;
}

/** Where the casting chrome sits relative to the caster (shadow falls away from it). */
export type EdgeShadowDirection = 'down' | 'up';

/**
 * Inline style for a thin edge-shadow caster element. `direction: 'down'` casts
 * the shadow downward (the tab strip elevates onto the editor below);
 * `direction: 'up'` casts upward (the status bar elevates onto the editor above).
 * Returns a zero-height transparent element in HC (opacity 0) so it is inert.
 *
 * The element is intended to be placed as a flex sibling OUTSIDE the strip/bar
 * boxes (so it never enters those clipped golden captures), with the band height
 * equal to EDGE_SHADOW_BLUR.
 */
export function edgeShadowStyle(theme: AppTheme, direction: EdgeShadowDirection): CSSProperties {
  const o = edgeShadowOpacity(theme);
  if (o <= 0) {
    return { height: 0, flex: '0 0 auto', pointerEvents: 'none' };
  }
  // down: chrome is ABOVE the caster → darkest at the TOP, fade downward.
  // up:   chrome is BELOW the caster → darkest at the BOTTOM, fade upward.
  const gradientTo = direction === 'down' ? 'bottom' : 'top';
  return {
    height: EDGE_SHADOW_BLUR,
    flex: '0 0 auto',
    pointerEvents: 'none',
    // Overlap the editor edge without consuming layout height in the editor
    // region: pull the caster onto the editor by its own height.
    marginBottom: direction === 'down' ? -EDGE_SHADOW_BLUR : 0,
    marginTop: direction === 'up' ? -EDGE_SHADOW_BLUR : 0,
    position: 'relative',
    zIndex: 2,
    background: `linear-gradient(to ${gradientTo}, ${shadowColor(o)} 0%, transparent 100%)`,
  };
}
