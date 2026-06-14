/**
 * View-mode (Alt+P preview / Alt+D diff) callback bridge (RENDERER, Lane B) — CM-free.
 *
 * The Monaco editor's keydown handler routes the macOS-safe Alt+P / Alt+D
 * accelerators (matched by physical event.code) into these host callbacks.
 * `useViewModeKeyboard` writes the ref; the editor reads it on each keydown.
 *
 * Lives in its own module (extracted from the deleted CM6 keymap.ts) so the
 * Monaco command path imports it without pulling any @codemirror code.
 */

/** Callbacks the Alt+P / Alt+D view-mode handler calls into. */
export interface ViewModeCallbacks {
  isPreviewEligible: () => boolean;
  togglePreview: () => void;
  toggleDiff: () => void;
}

/** Mutable ref bridging React state into the editor's keydown handler. */
export const viewModeCallbacksRef: { current: ViewModeCallbacks | null } = { current: null };
