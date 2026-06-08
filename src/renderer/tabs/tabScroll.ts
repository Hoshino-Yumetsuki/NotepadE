/**
 * Pure geometry helpers for the tab strip's scroll + selection-overlay behavior
 * (extracted from TabStrip so they are unit-testable without a layout engine —
 * jsdom's getBoundingClientRect returns zeros, so the component itself can only
 * be exercised end-to-end). All inputs are plain numbers in client (viewport) px.
 *
 * PA-8: pure — no DOM, no window.notepads, no Node.
 */

/** A measured box's horizontal extent in client px. */
export interface HBox {
  left: number;
  right: number;
}

/**
 * Clamp the active-tab elevation overlay to the LIST viewport (not the whole
 * strip). The strip also holds the hamburger + scroll-left button (left of the
 * list) and the add button + caption (right of it); the list itself owns the
 * overflow clip. getBoundingClientRect ignores that clip, so a tab scrolled out
 * the list's left edge still reports off-list geometry. Clamping to the strip
 * then pinned the overlay over the hamburger/scroll chrome as a stray
 * translucent block. Clamp to [list.left, list.right] instead and return null
 * once the tab is fully outside the list viewport, so the overlay vanishes.
 *
 * Returns strip-local coordinates ({ left, width } relative to strip.left), or
 * null when the visible width collapses to ≤ 0.
 */
export function clampOverlayToList(
  strip: HBox,
  list: HBox,
  tab: HBox
): { left: number; width: number } | null {
  const visLeft = list.left - strip.left;
  const visRight = list.right - strip.left;
  const rawLeft = tab.left - strip.left;
  const rawRight = rawLeft + (tab.right - tab.left);
  const left = Math.max(visLeft, rawLeft);
  const right = Math.min(visRight, rawRight);
  const width = Math.max(0, right - left);
  return width <= 0 ? null : { left, width };
}

/**
 * Compute the next `scrollLeft` that brings the active tab fully inside the list
 * viewport (UWP SetsView auto-scrolls the selected set into view). Returns the
 * CURRENT scrollLeft unchanged when the tab is already fully visible, so callers
 * can skip a no-op write. The result is clamped to [0, scrollWidth - clientWidth].
 *
 * @param scrollLeft  the list's current scrollLeft
 * @param list        the list viewport's client box
 * @param tab         the active tab's client box
 * @param scrollWidth the list's scrollWidth (full content width)
 * @param clientWidth the list's clientWidth (visible width)
 */
export function scrollLeftToReveal(
  scrollLeft: number,
  list: HBox,
  tab: HBox,
  scrollWidth: number,
  clientWidth: number
): number {
  // Already fully visible → no change.
  if (tab.left >= list.left && tab.right <= list.right) return scrollLeft;
  let next = scrollLeft;
  if (tab.left < list.left) {
    // Off the left edge: bring its left flush to the viewport's left.
    next += tab.left - list.left;
  } else {
    // Off the right edge: bring its right flush to the viewport's right.
    next += tab.right - list.right;
  }
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.max(0, Math.min(next, max));
}
