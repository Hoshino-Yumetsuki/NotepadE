import { describe, it, expect } from 'vitest';
import {
  tokensForAcrylic,
  acrylicVars,
  LIGHT_ACRYLIC_TOKENS,
  DARK_ACRYLIC_TOKENS,
  HC_ACRYLIC_TOKENS,
  ACRYLIC_VAR_TINT,
  ACRYLIC_VAR_BLUR,
  ACRYLIC_VAR_LUMINOSITY,
} from './tokens';

/**
 * Acrylic-approximation token unit tests (Phase 7, Task #26). Verifies per-theme
 * tint/blur selection, the UWP 0.75 tint-opacity grounding, the HC no-material
 * collapse, and the CSS-var bag the host element spreads.
 */
describe('tokensForAcrylic', () => {
  it('selects the per-theme recipes', () => {
    expect(tokensForAcrylic('light')).toBe(LIGHT_ACRYLIC_TOKENS);
    expect(tokensForAcrylic('dark')).toBe(DARK_ACRYLIC_TOKENS);
    expect(tokensForAcrylic('hc')).toBe(HC_ACRYLIC_TOKENS);
  });

  it('tints the in-page acrylic (settings pane) at 0.75', () => {
    // The .np-acrylic surface (settings pane / toasts) keeps a 0.75 tint — it is
    // a true backdrop-filter blur over IN-PAGE content, independent of the window
    // background tint default (DEFAULT_TINT_OPACITY, lowered to 0.5 so the window's
    // rgba tint doesn't compound with Electron's own acrylic material into a solid).
    expect(LIGHT_ACRYLIC_TOKENS.tint).toContain('0.75');
    expect(DARK_ACRYLIC_TOKENS.tint).toContain('0.75');
  });

  it('grounds the tint on the chrome base colors (240 light / 46 dark)', () => {
    expect(LIGHT_ACRYLIC_TOKENS.tint).toContain('240, 240, 240');
    expect(DARK_ACRYLIC_TOKENS.tint).toContain('46, 46, 46');
  });

  it('blurs light/dark but NOT high-contrast', () => {
    expect(LIGHT_ACRYLIC_TOKENS.blurRadius).toBeGreaterThan(0);
    expect(DARK_ACRYLIC_TOKENS.blurRadius).toBeGreaterThan(0);
    expect(HC_ACRYLIC_TOKENS.blurRadius).toBe(0);
  });

  it('collapses HC to an opaque flat system surface (no material)', () => {
    expect(HC_ACRYLIC_TOKENS.tint).toBe('Canvas');
    expect(HC_ACRYLIC_TOKENS.luminosity).toBe('transparent');
  });
});

describe('acrylicVars', () => {
  it('emits the three acrylic CSS custom properties', () => {
    const vars = acrylicVars('dark');
    expect(vars[ACRYLIC_VAR_TINT]).toBe(DARK_ACRYLIC_TOKENS.tint);
    expect(vars[ACRYLIC_VAR_BLUR]).toBe(`${DARK_ACRYLIC_TOKENS.blurRadius}px`);
    expect(vars[ACRYLIC_VAR_LUMINOSITY]).toBe(DARK_ACRYLIC_TOKENS.luminosity);
  });

  it('emits a 0px blur for HC', () => {
    expect(acrylicVars('hc')[ACRYLIC_VAR_BLUR]).toBe('0px');
  });
});
