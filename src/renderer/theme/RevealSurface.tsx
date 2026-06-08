/**
 * ============================================================================
 *  RevealSurface — reveal-brush host component (Phase 7, Stream C, Task #27)
 * ============================================================================
 *
 * Wraps any chrome surface (tab header, status-bar cell, caption button) to give
 * it the Fluent cursor-follow reveal highlight from ./reveal. It:
 *   - tracks the pointer via useReveal (writes --reveal-x/y/opacity on the host),
 *   - paints an absolutely-positioned radial-gradient layer (RevealLayer) that
 *     follows the cursor and fades to nothing at rest,
 *   - renders the surface content above the layer.
 *
 * The host is `position: relative` and `overflow: hidden` so the radial clip
 * matches the surface box (1:1 with a RevealBackground that is clipped to the
 * control bounds). The reveal layer is `pointer-events: none` so it never
 * intercepts clicks meant for the underlying control.
 *
 * GOLDEN-SAFE: opacity is 0 until the pointer enters; visual baselines capture
 * with no hover, so the layer is invisible there (see ./reveal header).
 *
 * PA-8: renderer-only, DOM + React. No fs/path/child_process, no IPC.
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  useReveal,
  revealGradient,
  tokensForReveal,
  REVEAL_VAR_OPACITY,
  type RevealTokens
} from './reveal';
import type { AppTheme } from './tokens';

// ---------------------------------------------------------------------------
//  RevealLayer — the radial-gradient overlay (no pointer tracking of its own)
// ---------------------------------------------------------------------------

export interface RevealLayerProps {
  tokens: RevealTokens;
  /** Border radius to match the host (keeps the highlight inside rounded corners). */
  borderRadius?: number;
  /** Optional test id for golden/behaviour assertions. */
  testid?: string;
}

/**
 * The radial highlight overlay. Sits absolutely inside a `position: relative`
 * host and reads the host's --reveal-* custom properties (written by useReveal).
 * Its own opacity is driven by --reveal-opacity so it disappears at rest.
 */
export function RevealLayer(props: RevealLayerProps): JSX.Element {
  const { tokens, borderRadius, testid } = props;
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    borderRadius,
    background: revealGradient(tokens),
    opacity: `var(${REVEAL_VAR_OPACITY}, 0)` as unknown as number,
    transition: 'opacity 120ms ease-out',
    zIndex: 0
  };
  return <span aria-hidden data-testid={testid} data-reveal-layer="true" style={style} />;
}

// ---------------------------------------------------------------------------
//  RevealSurface — host + layer + content in one element
// ---------------------------------------------------------------------------

export interface RevealSurfaceProps {
  /** App theme bucket → selects the reveal tint set. */
  theme: AppTheme;
  /** Rendered above the reveal layer (the actual control content). */
  children: ReactNode;
  /** Extra style merged onto the host (the host already sets position/overflow). */
  style?: CSSProperties;
  className?: string;
  borderRadius?: number;
  testid?: string;
  /** Host element tag — defaults to 'div'. Use 'span' inside inline flows. */
  as?: 'div' | 'span';
}

/**
 * A reveal-enabled host. Content is wrapped in a `position: relative` z-indexed
 * layer so it always paints above the radial highlight.
 */
export function RevealSurface(props: RevealSurfaceProps): JSX.Element {
  const { theme, children, style, className, borderRadius, testid, as = 'div' } = props;
  const { hostRef, handlers } = useReveal();
  const tokens = tokensForReveal(theme);

  const hostStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    borderRadius,
    ...style
  };
  const Tag = as;

  return (
    <Tag
      ref={hostRef as React.Ref<HTMLDivElement & HTMLSpanElement>}
      className={className}
      data-testid={testid}
      data-reveal-host="true"
      style={hostStyle}
      onPointerMove={handlers.onPointerMove}
      onPointerEnter={handlers.onPointerEnter}
      onPointerLeave={handlers.onPointerLeave}
    >
      <RevealLayer tokens={tokens} borderRadius={borderRadius} />
      <span style={{ position: 'relative', zIndex: 1, display: 'contents' }}>{children}</span>
    </Tag>
  );
}
