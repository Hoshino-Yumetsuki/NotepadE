/**
 * Share integration — RENDERER, Lane B (Phase 6).
 *
 * Ports the UWP Share command (DataTransferManager): share the current document's
 * title + text. The renderer NEVER touches the OS share sheet or clipboard directly
 * (PA-8) — it hands the payload to MAIN via `window.notepads.shell.share()`, which
 * performs the OS share where available and otherwise falls back to the clipboard.
 *
 * PA-8: pure renderer + the typed bridge.
 */

import { useCallback } from 'react';

/** Bound share action. */
export interface ShareActions {
  /** Share the given document title + text via MAIN. */
  share: (args: { title: string; text: string }) => Promise<void>;
}

/**
 * Share the title + text via MAIN. Exported (not just via the hook) so non-React
 * callers/tests can use it. Errors are swallowed (share is best-effort; a failure
 * must never break the editor).
 */
export async function shareDocument(args: { title: string; text: string }): Promise<void> {
  try {
    await window.notepads?.shell.share(args);
  } catch {
    // Best-effort: a failed share never surfaces to the editor.
  }
}

/**
 * useShare — returns a stable share action.
 *
 * WIRING (App.tsx integration pass — lane-a):
 *   const { share } = useShare();
 *   // Share command: share({ title: activeTabName, text: activeShadowText })
 */
export function useShare(): ShareActions {
  const share = useCallback(
    async (args: { title: string; text: string }): Promise<void> => {
      await shareDocument(args);
    },
    [],
  );
  return { share };
}
