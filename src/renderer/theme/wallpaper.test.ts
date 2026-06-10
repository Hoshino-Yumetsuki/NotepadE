/**
 * Wallpaper presentation helper tests (renderer, pure).
 *
 * Verifies the OPACITY SEMANTICS SWITCH that defines the feature:
 *   - no wallpaper → the root background is the translucent tint whose alpha
 *     is tintOpacity (the historical appBackgroundTint behavior),
 *   - wallpaper active → the root goes OPAQUE theme base and tintOpacity
 *     becomes the wallpaper layer's CSS opacity instead,
 *   - HC → no wallpaper layer ever; the root stays 'Canvas'.
 */

import { describe, it, expect } from 'vitest';
import { isWallpaperActive, appRootBackground, wallpaperLayerStyle } from './wallpaper';
import { appBackgroundTint, LIGHT_APP_TOKENS, DARK_APP_TOKENS } from './tokens';

describe('isWallpaperActive', () => {
  it('is active only with a persisted file name outside high contrast', () => {
    expect(isWallpaperActive('wallpaper-1.png', 'light')).toBe(true);
    expect(isWallpaperActive('wallpaper-1.png', 'dark')).toBe(true);
    expect(isWallpaperActive('', 'light')).toBe(false);
    // HC paints flat system colors — never imagery.
    expect(isWallpaperActive('wallpaper-1.png', 'hc')).toBe(false);
  });
});

describe('appRootBackground', () => {
  it('keeps the historical translucent tint when no wallpaper is set', () => {
    expect(appRootBackground('dark', 0.5, false)).toBe(appBackgroundTint('dark', 0.5));
    expect(appRootBackground('light', 0.25, false)).toBe(appBackgroundTint('light', 0.25));
  });

  it('switches to the OPAQUE theme base while a wallpaper is active', () => {
    // The image replaces the desktop see-through backdrop, so the root must
    // stop sampling the desktop regardless of the slider value.
    expect(appRootBackground('dark', 0.5, true)).toBe(DARK_APP_TOKENS.base);
    expect(appRootBackground('light', 0.0, true)).toBe(LIGHT_APP_TOKENS.base);
  });

  it('stays Canvas in high contrast either way', () => {
    expect(appRootBackground('hc', 0.5, false)).toBe('Canvas');
    expect(appRootBackground('hc', 0.5, true)).toBe('Canvas');
  });
});

describe('wallpaperLayerStyle', () => {
  it('uses tintOpacity as the LAYER opacity (the semantics switch)', () => {
    expect(wallpaperLayerStyle('data:image/png;base64,x', 0.7).opacity).toBe(0.7);
  });

  it('clamps the opacity to [0,1] (defensive against a stale settings file)', () => {
    expect(wallpaperLayerStyle('data:image/png;base64,x', 2).opacity).toBe(1);
    expect(wallpaperLayerStyle('data:image/png;base64,x', -1).opacity).toBe(0);
  });

  it('paints the image as a decorative cover layer under the UI', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,abc', 1);
    expect(s.backgroundImage).toBe('url("data:image/png;base64,abc")');
    expect(s.backgroundSize).toBe('cover');
    expect(s.zIndex).toBe(-1); // below in-flow content within the isolated root
    expect(s.pointerEvents).toBe('none');
  });
});
