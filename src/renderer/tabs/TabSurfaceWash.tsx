import { tokensForTheme, TabDimensions } from './tokens';

/**
 * The single continuous wash sheet behind the strip + editor (UWP SetsView:
 * selected-tab brush == content brush). One absolutely-positioned layer mounted
 * inside #app-shell that paints the editor band AND extends UP under the active
 * tab — the two are joined into an inverted-T by `clip-path`, so the selected tab
 * and the editor are ONE painted surface with no strip→editor seam (the boundary
 * is internal to a single paint instead of being the meeting line of two separate
 * translucent washes — the previous "接缝").
 *
 * It extends `TabDimensions.height` px ABOVE #app-shell's top so the notch reaches
 * up over the active tab's body (the strip above is transparent, so the notch
 * shows through under the active tab; the notch is clipped to only the active-tab
 * column, so it can never bleed under the hamburger / scroll / add chrome). When
 * there is no measurable active tab (empty strip, scrolled fully out, or mid-drag)
 * it collapses to a plain full-width band — no stray notch stranded at an old x.
 *
 * Pure presentation: pointer-events:none, aria-hidden, zIndex 0 (below the editor
 * hosts and the transparent strip). HC has no material — headerSelected resolves
 * to the Highlight system color there, which would be wrong as a full content
 * wash, so HC renders nothing (the editor stays flat Canvas like UWP HC).
 */
export function TabSurfaceWash(props: {
  rect: { left: number; width: number } | null;
  theme: 'light' | 'dark' | 'hc';
}): JSX.Element | null {
  const { rect, theme } = props;
  // HC: flat forced-colors chrome, no translucent merge wash (matches UWP HC).
  if (theme === 'hc') return null;
  const wash = tokensForTheme(theme).headerSelected;
  // Notch band height = the active tab's body height (the strip's 1px top border
  // is above it). The wash is lifted by this much so its top edge aligns with the
  // tab body's top, and the top `H` px of the layer is the notch region.
  const H = TabDimensions.height;
  // Inverted-T: the active-tab notch (top H px, only under [left, left+width])
  // sitting on the full-width editor band (below H). With no rect, just the band.
  const clipPath = rect
    ? `polygon(` +
      `${rect.left}px 0, ${rect.left + rect.width}px 0, ` + // notch top edge
      `${rect.left + rect.width}px ${H}px, 100% ${H}px, ` + // down + across to right
      `100% 100%, 0 100%, ` + // right→bottom→left
      `0 ${H}px, ${rect.left}px ${H}px)` // up + across back to notch
    : `polygon(0 ${H}px, 100% ${H}px, 100% 100%, 0 100%)`;
  return (
    <div
      data-testid="tab-surface-wash"
      aria-hidden
      style={{
        position: 'absolute',
        top: -H,
        left: 0,
        right: 0,
        bottom: 0,
        background: wash,
        clipPath,
        WebkitClipPath: clipPath,
        pointerEvents: 'none',
        zIndex: 0
      }}
    />
  );
}
