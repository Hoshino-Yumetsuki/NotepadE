/**
 * View-mode keyboard controller. Owns the Alt+P preview and Alt+D diff
 * accelerators while App owns tab state.
 *
 * Capture-phase prevention stops Option+letter composition from reaching the
 * editor; the callback bridge provides a final guard inside editor key handling.
 */

import { useEffect } from 'react';
import { viewModeCallbacksRef, type ViewModeCallbacks } from '../editor/commands/viewModeBridge';

export function useViewModeKeyboard(callbacks: ViewModeCallbacks): void {
  const { isPreviewEligible, togglePreview, toggleDiff } = callbacks;

  // Capture-phase prevention stops the event before the editor sees it.
  // The editor callback bridge provides a final belt-and-suspenders guard.
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

  // The editor callback bridge provides a final belt-and-suspenders guard.
  useEffect(() => {
    viewModeCallbacksRef.current = callbacks;
    return () => {
      viewModeCallbacksRef.current = null;
    };
  }, [callbacks]);
}
