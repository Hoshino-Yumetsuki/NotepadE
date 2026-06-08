/**
 * View-mode keyboard controller — RENDERER, Lane B (Phase 6).
 *
 * Owns the Alt+P (preview) / Alt+D (diff) accelerators. The hook does NOT own
 * tab state (lane-a owns the store + App.tsx).
 *
 * macOS requires THREE layers of prevention because Option+letter composition
 * can leak through CM6's keymap pipeline even at Prec.highest:
 *   1. Window capture-phase keydown → stopPropagation() kills the event before
 *      it reaches CM6's DOM element at all.
 *   2. Window capture-phase keypress → backup prevention for browsers that
 *      fire keypress after a prevented keydown.
 *   3. CM6 viewModeCommandExtension (Prec.highest any handler) → belt-and-suspenders
 *      if layer 1/2 miss, matching Alt+Z's proven pattern.
 *
 * PA-8: pure renderer. No IPC, no fs.
 */

import { useEffect } from 'react';
import { viewModeCallbacksRef, type ViewModeCallbacks } from '../editor/commands/keymap';

export type { ViewModeCallbacks };

export function useViewModeKeyboard(callbacks: ViewModeCallbacks): void {
  const { isPreviewEligible, togglePreview, toggleDiff } = callbacks;

  // Layer 1+2: window capture-phase prevention (stops event BEFORE CM6 sees it).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.code === 'KeyP') {
        if (!isPreviewEligible()) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        togglePreview();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleDiff();
      }
    };
    const onKeyPress = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.code === 'KeyP' || e.code === 'KeyD') {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keypress', onKeyPress, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keypress', onKeyPress, true);
    };
  }, [isPreviewEligible, togglePreview, toggleDiff]);

  // Layer 3: CM6 ref bridge (belt-and-suspenders, same pattern as Alt+Z).
  useEffect(() => {
    viewModeCallbacksRef.current = callbacks;
    return () => {
      viewModeCallbacksRef.current = null;
    };
  }, [callbacks]);
}
