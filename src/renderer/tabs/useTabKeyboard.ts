import { useEffect } from 'react';
import type { TabsStore } from './useTabsStore';

/**
 * ============================================================================
 *  Tab keyboard shortcuts (Phase 2, task #1e) — docs/plan/10 "App level"
 * ============================================================================
 *
 * Window-level keymap wired to the TabsStore:
 *   Ctrl+N / Ctrl+T  new tab            (onNewTab)
 *   Ctrl+W           close active tab
 *   Ctrl+Tab         next tab (wraps)
 *   Ctrl+Shift+Tab   prev tab (wraps)
 *   Ctrl+1 .. Ctrl+9 jump to tab (9 == last)
 *   F2               rename active tab   (onRename)
 *
 * These mirror the UWP NotepadsMainPage.xaml.cs keyboard-accelerator bindings.
 * The browser/CM6 defaults for Ctrl+Tab/Ctrl+1-9 are swallowed in source; we
 * preventDefault so they don't reach CM6 or trigger browser tab cycling.
 *
 * Bound on the capture phase at the document so the strip works regardless of
 * focus (editor focused, tab focused, etc.), matching the app-wide accelerators.
 */

export interface TabKeyboardCallbacks {
  /** Ctrl+N / Ctrl+T — create a new untitled tab. */
  onNewTab(): void;
  /** F2 — begin rename on the active tab. */
  onRename(activeEditorId: string): void;
  /**
   * Ctrl+W — close the active tab. Defaults to store.close; override to add a
   * dirty-save prompt later (Phase 4). Receives the active editorId.
   */
  onCloseActive?(activeEditorId: string): void;
}

export function useTabKeyboard(store: TabsStore, callbacks: TabKeyboardCallbacks): void {
  const { onNewTab, onRename, onCloseActive } = callbacks;

  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      // Only Ctrl-chord shortcuts and the bare F2 are handled here.
      const ctrl = e.ctrlKey || e.metaKey;

      // F2 rename (no modifier).
      if (e.key === 'F2' && !ctrl && !e.altKey) {
        const active = store.activeEditorId;
        if (active) {
          e.preventDefault();
          onRename(active);
        }
        return;
      }

      if (!ctrl) return;

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tabs (swallow CM6/browser default).
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) store.prev();
        else store.next();
        return;
      }

      // Everything below is a non-shift Ctrl chord.
      if (e.altKey) return;

      // Ctrl+N / Ctrl+T — new tab.
      if (!e.shiftKey && (e.key === 'n' || e.key === 'N' || e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        onNewTab();
        return;
      }

      // Ctrl+W — close active tab.
      if (!e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        const active = store.activeEditorId;
        if (active) {
          e.preventDefault();
          if (onCloseActive) onCloseActive(active);
          else store.close(active);
        }
        return;
      }

      // Ctrl+1 .. Ctrl+9 — jump. Use e.code so Shift/layout doesn't matter, but
      // require no shift (Ctrl+Shift+N is "new instance" at app level).
      if (!e.shiftKey && e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          store.jumpTo(n);
        }
        return;
      }
    }

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [store, onNewTab, onRename, onCloseActive]);
}
