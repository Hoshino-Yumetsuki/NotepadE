/**
 * Wallpaper presentation helper tests (renderer, pure).
 *
 * Verifies the OPACITY SEMANTICS SWITCH that defines the feature:
 *   - no wallpaper → the root background is the translucent tint whose alpha
 *     is tintOpacity (the historical appBackgroundTint behavior),
 *   - wallpaper active → the root goes OPAQUE theme base and tintOpacity
 *     becomes the wallpaper layer's BLUR intensity instead (0..48px frost
 *     converging on the acrylic look; the image itself stays fully opaque),
 *   - HC → no wallpaper layer ever; the root stays 'Canvas'.
 */

import { describe, it, expect } from 'vitest';
import {
  isWallpaperActive,
  appRootBackground,
  wallpaperLayerStyle,
  WALLPAPER_BLUR_MAX_PX
} from './wallpaper';
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
  it('uses tintOpacity as the layer BLUR intensity (the semantics switch)', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,x', 0.5);
    const blurPx = Math.round(0.5 * WALLPAPER_BLUR_MAX_PX);
    expect(s.filter).toContain(`blur(${blurPx}px)`);
    // Acrylic-style saturation lift accompanies the blur.
    expect(s.filter).toContain('saturate(');
    // The image itself stays fully opaque — blur replaces the old fade.
    expect(s.opacity).toBeUndefined();
    // Overscan by the blur radius so the edge falloff lands off-window.
    expect(s.inset).toBe(-blurPx);
  });

  it('skips the filter entirely at 0 (identity blur still costs a pass)', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,x', 0);
    expect(s.filter).toBeUndefined();
    expect(s.inset).toBe(-0);
  });

  it('clamps the blur to [0,max] (defensive against a stale settings file)', () => {
    expect(wallpaperLayerStyle('data:image/png;base64,x', 2).filter).toContain(
      `blur(${WALLPAPER_BLUR_MAX_PX}px)`
    );
    expect(wallpaperLayerStyle('data:image/png;base64,x', -1).filter).toBeUndefined();
  });

  it('paints the image as a decorative cover layer under the UI', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,abc', 1);
    expect(s.backgroundImage).toBe('url("data:image/png;base64,abc")');
    expect(s.backgroundSize).toBe('cover');
    expect(s.zIndex).toBe(-1); // below in-flow content within the isolated root
    expect(s.pointerEvents).toBe('none');
  });
});
