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
 *     becomes the CSS opacity of the WALLPAPER layer instead, fading the image
 *     into the solid base color (0 = plain base, 1 = full-strength image).
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
 * Inline style for the wallpaper layer div. `cover` + center crops like an OS
 * desktop wallpaper; `pointerEvents:'none'` keeps it purely decorative; the
 * clamped `tintOpacity` IS the layer opacity while a wallpaper is active (the
 * semantics switch — see module header).
 */
export function wallpaperLayerStyle(dataUrl: string, tintOpacity: number): CSSProperties {
  const clamped = Math.max(0, Math.min(1, tintOpacity));
  return {
    position: 'absolute',
    inset: 0,
    zIndex: -1,
    backgroundImage: `url("${dataUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    opacity: clamped,
    pointerEvents: 'none'
  };
}
