/**
 * Custom wallpaper presentation — renderer-side pure helpers (web-port-only).
 *
 * When the user sets a background image (Personalization), the renderer paints
 * it as a full-window layer UNDER every UI surface. The app's surfaces are
 * (semi-)transparent so the window's desktop see-through backdrop normally
 * shows through (Win11 acrylic material / macOS vibrancy); the wallpaper layer
 * slots in exactly where the desktop used to show, REPLACING that backdrop
 * with a cross-platform CSS layer (this is also the macOS answer: vibrancy
 * composites differently from Windows acrylic and the tint slider reads
 * inconsistently there, but a CSS wallpaper renders identically everywhere).
 *
 * Opacity semantics SWITCH when a wallpaper is active:
 *   - no wallpaper: `tintOpacity` is the ALPHA of the rgba window tint layered
 *     over the OS material (appBackgroundTint — the historical behavior),
 *   - wallpaper active: the root goes OPAQUE theme-base (the desktop must not
 *     show through anymore — the wallpaper replaces it) and `tintOpacity`
 *     drives the WALLPAPER layer's selected effect (`wallpaperEffect`) instead:
 *       - 'blur': the image stays fully opaque and the slider maps to a CSS
 *         blur(0..48px) (plus a mild saturation lift), so at 1 the frosted
 *         image visually converges on the acrylic material look the window has
 *         when no wallpaper is set,
 *       - 'opacity': the slider IS the layer's CSS opacity — 1 = fully visible
 *         wallpaper, 0 = invisible (the opaque theme base shows through). No
 *         filter, no overscan.
 *
 * Layering: the root element sets `isolation:'isolate'` (own stacking context)
 * and the wallpaper div sits at zIndex -1 — within an isolated context a
 * negative-z child paints ABOVE the root's own background but BELOW all in-flow
 * content, which is precisely "under every UI surface, over the base color".
 *
 * HC: no wallpaper — UWP high contrast paints flat opaque system colors with
 * no material/imagery, so the layer is suppressed and the root stays 'Canvas'.
 *
 * PA-8: pure data/style computation — no fs/path, no IPC (the data URL arrives
 * via useWallpaper → window.notepads.wallpaper).
 */

import type { CSSProperties } from 'react';
import type { WallpaperEffect } from '@shared/ipc-contract';
import { appBackgroundTint, tokensForAppTheme, type AppTheme } from './tokens';

/**
 * Whether the wallpaper layer should render: a managed file name is persisted
 * AND we are not in high contrast (HC = flat system colors, no imagery).
 */
export function isWallpaperActive(wallpaperFileName: string, theme: AppTheme): boolean {
  return wallpaperFileName !== '' && theme !== 'hc';
}

/**
 * The app root's background for the current mode (see module header):
 *   - HC           → 'Canvas' (flat opaque system color, no material),
 *   - wallpaper on → opaque theme base (the image replaces the see-through
 *                    backdrop; the desktop must no longer sample through),
 *   - wallpaper off→ the historical translucent tint (alpha = tintOpacity)
 *                    over the OS acrylic/vibrancy material.
 */
export function appRootBackground(
  theme: AppTheme,
  tintOpacity: number,
  wallpaperActive: boolean
): string {
  if (theme === 'hc') return 'Canvas';
  if (wallpaperActive) return tokensForAppTheme(theme).base;
  return appBackgroundTint(theme, tintOpacity);
}

/**
 * Max wallpaper blur radius (px) at slider value 1. 48px frosts a 4K-ish image
 * into soft color fields — close enough to the Win11 acrylic backdrop that the
 * slider's top end reads as "almost no wallpaper, just the material".
 */
export const WALLPAPER_BLUR_MAX_PX = 48;

/**
 * Inline style for the wallpaper layer div. `cover` + center crops like an OS
 * desktop wallpaper; `pointerEvents:'none'` keeps it purely decorative; the
 * clamped `tintOpacity` drives the SELECTED EFFECT while a wallpaper is active
 * (the semantics switch — see module header):
 *   - effect 'blur': the image stays fully opaque and the slider maps
 *     0..1 → blur(0..48px) with a mild saturation lift (acrylic-style) so the
 *     top end converges on the no-wallpaper material look. The layer is
 *     OVERSCANNED by the blur radius (negative inset) so the blur's
 *     transparent edge falloff lands outside the window instead of as a halo.
 *   - effect 'opacity': the slider IS the layer's CSS opacity (1 = fully
 *     visible, 0 = invisible over the opaque theme base). No filter, no
 *     overscan (inset 0).
 */
export function wallpaperLayerStyle(
  dataUrl: string,
  tintOpacity: number,
  effect: WallpaperEffect
): CSSProperties {
  const clamped = Math.max(0, Math.min(1, tintOpacity));
  const base: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: -1,
    backgroundImage: `url("${dataUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    pointerEvents: 'none'
  };
  if (effect === 'opacity') {
    // Slider = layer opacity: higher = more opaque wallpaper. No filter and no
    // overscan — the edges stay flush with the window.
    return { ...base, opacity: clamped };
  }
  const blurPx = Math.round(clamped * WALLPAPER_BLUR_MAX_PX);
  return {
    ...base,
    inset: -blurPx,
    // blur(0px) is an identity filter but still forces an extra compositing
    // pass on a window-sized layer — skip the filter entirely at 0.
    filter: blurPx > 0 ? `blur(${blurPx}px) saturate(${1 + 0.25 * clamped})` : undefined
  };
}
