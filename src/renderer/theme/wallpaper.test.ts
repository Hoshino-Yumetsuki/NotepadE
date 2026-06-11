/**
 * Wallpaper presentation helper tests (renderer, pure).
 *
 * Verifies the OPACITY SEMANTICS SWITCH that defines the feature:
 *   - no wallpaper → the root background is the translucent tint whose alpha
 *     is tintOpacity (the historical appBackgroundTint behavior),
 *   - wallpaper active → the root goes OPAQUE theme base and tintOpacity
 *     drives the wallpaper layer's SELECTED EFFECT instead:
 *       - 'blur' → blur intensity (0..48px frost converging on the acrylic
 *         look; the image itself stays fully opaque, overscanned layer),
 *       - 'opacity' → the layer's CSS opacity (no filter, no overscan),
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

describe('wallpaperLayerStyle (blur effect)', () => {
  it('uses tintOpacity as the layer BLUR intensity (the semantics switch)', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,x', 0.5, 'blur');
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
    const s = wallpaperLayerStyle('data:image/png;base64,x', 0, 'blur');
    expect(s.filter).toBeUndefined();
    expect(s.inset).toBe(-0);
  });

  it('clamps the blur to [0,max] (defensive against a stale settings file)', () => {
    expect(wallpaperLayerStyle('data:image/png;base64,x', 2, 'blur').filter).toContain(
      `blur(${WALLPAPER_BLUR_MAX_PX}px)`
    );
    expect(wallpaperLayerStyle('data:image/png;base64,x', -1, 'blur').filter).toBeUndefined();
  });

  it('paints the image as a decorative cover layer under the UI', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,abc', 1, 'blur');
    expect(s.backgroundImage).toBe('url("data:image/png;base64,abc")');
    expect(s.backgroundSize).toBe('cover');
    expect(s.zIndex).toBe(-1); // below in-flow content within the isolated root
    expect(s.pointerEvents).toBe('none');
  });
});

describe('wallpaperLayerStyle (opacity effect)', () => {
  it('uses tintOpacity as the layer CSS opacity — no filter, no overscan', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,x', 0.4, 'opacity');
    expect(s.opacity).toBe(0.4);
    // No frost in opacity mode — the slider only fades the image.
    expect(s.filter).toBeUndefined();
    // No blur falloff to hide, so the layer stays flush with the window.
    expect(s.inset).toBe(0);
  });

  it('maps slider 1 → fully visible and 0 → invisible', () => {
    expect(wallpaperLayerStyle('data:x', 1, 'opacity').opacity).toBe(1);
    expect(wallpaperLayerStyle('data:x', 0, 'opacity').opacity).toBe(0);
  });

  it('clamps the opacity to [0,1] (defensive against a stale settings file)', () => {
    expect(wallpaperLayerStyle('data:x', 2, 'opacity').opacity).toBe(1);
    expect(wallpaperLayerStyle('data:x', -1, 'opacity').opacity).toBe(0);
  });

  it('keeps the decorative cover-layer geometry of the blur mode', () => {
    const s = wallpaperLayerStyle('data:image/png;base64,abc', 0.5, 'opacity');
    expect(s.backgroundImage).toBe('url("data:image/png;base64,abc")');
    expect(s.backgroundSize).toBe('cover');
    expect(s.zIndex).toBe(-1);
    expect(s.pointerEvents).toBe('none');
  });
});

describe('wallpaperLayerStyle (effect dispatch)', () => {
  it('the same slider value yields blur in blur mode and fade in opacity mode', () => {
    const blur = wallpaperLayerStyle('data:x', 0.5, 'blur');
    const fade = wallpaperLayerStyle('data:x', 0.5, 'opacity');
    expect(blur.filter).toBeDefined();
    expect(blur.opacity).toBeUndefined();
    expect(fade.filter).toBeUndefined();
    expect(fade.opacity).toBe(0.5);
  });
});
