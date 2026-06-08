/**
 * View-mode keyboard controller — RENDERER, Lane B (Phase 6).
 *
 * Owns the Alt+P (preview) / Alt+D (diff) accelerators that toggle the active
 * tab's content view mode (SessionTab.viewMode.{preview,diff} in the frozen
 * contract). Ports the UWP markdown-preview + side-by-side-diff toggle commands.
 *
 * This hook does NOT own tab state (lane-a owns the store + App.tsx). It is a pure
 * keybinding installer: the host passes callbacks that flip the active tab's
 * viewMode flags, plus a predicate for whether the active tab is markdown-eligible
 * (Alt+P is offered only for the .md family — UWP parity). Preview and diff are
 * mutually exclusive in the UI; the host's toggle callbacks should clear the other
 * flag (documented in the wiring note).
 *
 * PA-8: pure renderer (window keyboard events + callbacks). No IPC, no fs.
 *
 * WIRING (App.tsx integration pass — lane-a):
 *   useViewModeKeyboard({
 *     isPreviewEligible: () => isMarkdownPath(activeTab?.filePath ?? null),
 *     togglePreview: () => store.setViewMode(activeId, { preview: !cur.preview, diff: false }),
 *     toggleDiff:    () => store.setViewMode(activeId, { diff: !cur.diff, preview: false }),
 *   });
 * (import isMarkdownPath from '../markdown/renderMarkdown'.)
 */

import { useEffect } from 'react';

export interface ViewModeKeyboardCallbacks {
  /** True when the active tab may show the markdown preview (Alt+P gate). */
  isPreviewEligible: () => boolean;
  /** Toggle the active tab's preview mode (and clear diff). */
  togglePreview: () => void;
  /** Toggle the active tab's diff mode (and clear preview). */
  toggleDiff: () => void;
}

/**
 * Install the Alt+P / Alt+D view-mode accelerators on the window for the lifetime
 * of the host component. Bindings require Alt WITHOUT Ctrl/Meta so they never
 * collide with the editor/find/tab shortcuts. Alt+P is ignored when the active tab
 * is not preview-eligible (non-markdown).
 *
 * Listens on the CAPTURE phase so the handler runs BEFORE CodeMirror processes the
 * keydown. On macOS, Option+letter is a composed character (Option+P → "π") that
 * CM6 commits through its own input pipeline during the editor's keydown handling;
 * a bubble-phase preventDefault then comes too late and the "π" leaks into the
 * document. Capturing at the window lets us preventDefault first, so the accelerator
 * fires and no character is inserted.
 */
export function useViewModeKeyboard(callbacks: ViewModeKeyboardCallbacks): void {
  const { isPreviewEligible, togglePreview, toggleDiff } = callbacks;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      // e.code is layout-independent ('KeyP' / 'KeyD'); e.key under Alt can be an
      // OS-composed character on some layouts, so match the physical key.
      if (e.code === 'KeyP') {
        if (!isPreviewEligible()) return;
        e.preventDefault();
        togglePreview();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        toggleDiff();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isPreviewEligible, togglePreview, toggleDiff]);
}
