import { describe, it, expect } from 'vitest';
import { clampOverlayToList, scrollLeftToReveal, type HBox } from './tabScroll';

/**
 * Pure geometry tests for the tab-strip scroll + selection-overlay helpers.
 * These cover the two reported bugs:
 *   1. clicking (+) selected an off-screen tab but the scrollbar didn't follow it
 *      → scrollLeftToReveal nudges the list so the active tab is fully visible;
 *   2. a selected tab scrolled out of view left its elevation overlay pinned over
 *      the hamburger/scroll chrome as a stray translucent block
 *      → clampOverlayToList clamps to the LIST viewport and returns null once the
 *        tab is fully outside it.
 */

const box = (left: number, right: number): HBox => ({ left, right });

describe('clampOverlayToList', () => {
  // strip starts at x=0; the list viewport sits at [48, 400] (48px = hamburger +
  // scroll-left chrome to its left), inside a 0..520 strip (add button + caption
  // to the right). Coordinates returned are strip-local (relative to strip.left).
  const strip = box(0, 520);
  const list = box(48, 400);

  it('returns the in-list visible portion for a fully-visible tab', () => {
    // Tab fully inside the list viewport.
    const r = clampOverlayToList(strip, list, box(100, 190));
    expect(r).toEqual({ left: 100, width: 90 });
  });

  it('clamps the LEFT edge to the list viewport, not the strip (no chrome bleed)', () => {
    // Tab scrolled so its left (20) is under the hamburger/scroll chrome (< 48).
    // Must clamp to the list's left (48), NOT strip-x 0 — that pin-to-0 was the
    // translucent-block bug.
    const r = clampOverlayToList(strip, list, box(20, 150));
    expect(r).toEqual({ left: 48, width: 102 });
  });

  it('clamps the RIGHT edge to the list viewport', () => {
    // Tab runs past the list's right edge (400) toward the add button.
    const r = clampOverlayToList(strip, list, box(360, 470));
    expect(r).toEqual({ left: 360, width: 40 });
  });

  it('returns null when the tab is fully scrolled off the list LEFT edge', () => {
    // Entirely left of the list viewport → overlay must vanish, not pin to 0.
    expect(clampOverlayToList(strip, list, box(-120, 20))).toBeNull();
  });

  it('returns null when the tab is fully off the list RIGHT edge', () => {
    expect(clampOverlayToList(strip, list, box(420, 510))).toBeNull();
  });

  it('returns null on a zero-width sliver exactly at the edge', () => {
    // Right edge exactly at the list's left edge → width 0 → null.
    expect(clampOverlayToList(strip, list, box(0, 48))).toBeNull();
  });
});

describe('scrollLeftToReveal', () => {
  // List viewport [0, 300] in client px, content scrollWidth 1000, clientWidth 300
  // → max scrollLeft = 700.
  const list = box(0, 300);
  const scrollWidth = 1000;
  const clientWidth = 300;

  it('is a no-op when the active tab is already fully visible', () => {
    const r = scrollLeftToReveal(120, list, box(40, 130), scrollWidth, clientWidth);
    expect(r).toBe(120);
  });

  it('scrolls RIGHT to reveal a tab off the right edge (clicking + past the edge)', () => {
    // Tab right (360) is 60px past the viewport right (300) → scroll right by 60.
    const r = scrollLeftToReveal(200, list, box(270, 360), scrollWidth, clientWidth);
    expect(r).toBe(260);
  });

  it('scrolls LEFT to reveal a tab off the left edge', () => {
    // Tab left (-40) is 40px before the viewport left (0) → scroll left by 40.
    const r = scrollLeftToReveal(200, list, box(-40, 50), scrollWidth, clientWidth);
    expect(r).toBe(160);
  });

  it('clamps the result to the max scrollLeft (never overscrolls)', () => {
    // A huge right overshoot is capped at scrollWidth - clientWidth = 700.
    const r = scrollLeftToReveal(680, list, box(900, 990), scrollWidth, clientWidth);
    expect(r).toBe(700);
  });

  it('clamps the result to 0 (never negative)', () => {
    const r = scrollLeftToReveal(10, list, box(-200, -110), scrollWidth, clientWidth);
    expect(r).toBe(0);
  });
});
