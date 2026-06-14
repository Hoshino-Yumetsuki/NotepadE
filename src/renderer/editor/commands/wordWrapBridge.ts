/**
 * Word-wrap global-preference bridge (RENDERER, Lane B) — CM-free.
 *
 * A mutable ref the App installs so the in-editor Alt+Z toggle (and the
 * right-click "Word Wrap" item) flip the persisted, app-wide `textWrapping`
 * setting instead of one editor's local state — so word wrap is a single
 * preference applied to every open file and surviving restarts. Left null in
 * tests / when no host is mounted (the Monaco wiring then falls back to flipping
 * the focused editor's `wordWrap` option locally).
 *
 * Lives in its own module (extracted from the deleted CM6 wordWrap.ts) so the
 * Monaco command path can import it without pulling any @codemirror code.
 */
export const wordWrapToggleRef: { current: (() => void) | null } = { current: null };
