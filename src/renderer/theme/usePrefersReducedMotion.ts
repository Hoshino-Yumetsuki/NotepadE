/**
 * usePrefersReducedMotion — shared accessibility gate for animations.
 *
 * Every animation added to the app must degrade when the user has requested
 * reduced motion. Inline `transition`/`animation` styles can't be reached by a
 * CSS `@media (prefers-reduced-motion)` query, so JS-driven motion routes
 * through this hook (React) or `prefersReducedMotion()` (non-React) instead.
 *
 * Mirrors the matchMedia pattern already used by editor/lineNumberGlow.ts
 * (glowDisabledByMedia), kept as the single shared reader so motion gating is
 * consistent across the renderer.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Non-reactive read — safe in module scope, effects, and event handlers. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches ?? false;
}

/**
 * Reactive variant for components that need to re-render when the OS setting
 * changes mid-session. Returns true when the user prefers reduced motion.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (): void => setReduced(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
