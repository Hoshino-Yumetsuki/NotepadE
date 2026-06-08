import { describe, it, expect } from 'vitest';
import {
  tokensForReveal,
  revealGradient,
  LIGHT_REVEAL_TOKENS,
  DARK_REVEAL_TOKENS,
  HC_REVEAL_TOKENS,
  REVEAL_VAR_X,
  REVEAL_VAR_Y
} from './reveal';

/**
 * Reveal-brush token + gradient unit tests (Phase 7, Task #27). Verifies the
 * per-theme tint selection and that the radial-gradient string is anchored to
 * the cursor custom properties (the cursor-follow contract) and clipped to the
 * configured radius.
 */
describe('tokensForReveal', () => {
  it('selects the light tint set', () => {
    expect(tokensForReveal('light')).toBe(LIGHT_REVEAL_TOKENS);
  });

  it('selects the dark tint set', () => {
    expect(tokensForReveal('dark')).toBe(DARK_REVEAL_TOKENS);
  });

  it('selects the HC tint set', () => {
    expect(tokensForReveal('hc')).toBe(HC_REVEAL_TOKENS);
  });

  it('uses BLACK overlay on light (darken) and WHITE on dark (brighten)', () => {
    expect(LIGHT_REVEAL_TOKENS.hoverColor).toContain('0, 0, 0');
    expect(DARK_REVEAL_TOKENS.hoverColor).toContain('255, 255, 255');
  });

  it('pressed is stronger than hover within a theme', () => {
    // Compare the trailing alpha of the rgba() strings.
    const alpha = (rgba: string): number => Number(rgba.match(/[\d.]+\)$/)?.[0].replace(')', ''));
    expect(alpha(LIGHT_REVEAL_TOKENS.pressedColor)).toBeGreaterThan(
      alpha(LIGHT_REVEAL_TOKENS.hoverColor)
    );
    expect(alpha(DARK_REVEAL_TOKENS.pressedColor)).toBeGreaterThan(
      alpha(DARK_REVEAL_TOKENS.hoverColor)
    );
  });

  it('disables the reveal material in HC (transparent tints)', () => {
    expect(HC_REVEAL_TOKENS.hoverColor).toBe('transparent');
    expect(HC_REVEAL_TOKENS.pressedColor).toBe('transparent');
  });
});

describe('revealGradient', () => {
  it('anchors the radial center on the cursor custom properties', () => {
    const g = revealGradient(DARK_REVEAL_TOKENS);
    expect(g).toContain(`var(${REVEAL_VAR_X}`);
    expect(g).toContain(`var(${REVEAL_VAR_Y}`);
  });

  it('parks the center far offscreen by default (no highlight at rest)', () => {
    const g = revealGradient(LIGHT_REVEAL_TOKENS);
    expect(g).toContain('-9999px');
  });

  it('clips to the token radius and the hover tint', () => {
    const g = revealGradient(DARK_REVEAL_TOKENS);
    expect(g).toContain(`${DARK_REVEAL_TOKENS.radius}px`);
    expect(g).toContain(DARK_REVEAL_TOKENS.hoverColor);
    expect(g).toContain('transparent 100%');
  });
});
