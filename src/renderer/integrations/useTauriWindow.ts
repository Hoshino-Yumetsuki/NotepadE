import { useEffect } from 'react';
import type { TabsStore } from '../tabs/useTabsStore';

interface UseTauriWindowProps {
  store: TabsStore;
  openPathIntoTab: (path: string) => void;
  setAppClosePending: (pending: boolean) => void;
}

export function useTauriWindow({
  store,
  openPathIntoTab,
  setAppClosePending
}: UseTauriWindowProps): void {
  // App-level close reminder (UWP MainPage_CloseRequested → AppCloseSaveReminderDialog).
  // MAIN intercepts the native window close (X / Alt+F4 / OS) and pushes
  // onCloseRequested; we run the unsaved-changes flow, then call window.confirmClose()
  // to let the real close proceed. `appClosePending` shows the dialog while the user
  // decides. NOTE: UWP skips this prompt when session-snapshot is ON (it persists the
  // session instead). Renderer session persistence is not yet wired, so we ALWAYS
  // prompt on dirty tabs — prompting can never lose data; silently closing could.
  useEffect(() => {
    return window.notepads.window.onCloseRequested(() => {
      const anyDirty = store.tabs.some((t) => t.isModified);
      if (!anyDirty) {
        void window.notepads.window.confirmClose();
        return;
      }
      setAppClosePending(true);
    });
  }, [store, setAppClosePending]);

  // App-window activation (Workstream 6.A): a broker redirect/spawn delivers the
  // file paths to open into THIS window. Open each via the shared primitive.
  useEffect(() => {
    const off = window.notepads.app.onActivation((event) => {
      for (const path of event.paths) openPathIntoTab(path);
    });
    return off;
  }, [openPathIntoTab]);

  // Drag-drop open (Tauri native onDragDropEvent). Tauri provides absolute
  // paths directly via native drag-drop — the web-level drop listener is
  // replaced because Electron's webUtils.getPathForFile has no Tauri equivalent.
  // The native event only fires for OS file drops; it does NOT intercept the
  // dnd-kit intra-strip reorder (pointer-driven) or the cross-window tab-
  // transfer token drag (which carries 'application/x-notepads-token').
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    // Guard: only activate inside a Tauri webview. jsdom/vitest never enters here.
    if (!('__TAURI_INTERNALS__' in window)) return;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      void getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            for (const path of event.payload.paths) {
              openPathIntoTab(path);
            }
          }
        })
        .then((fn) => {
          unlisten = fn;
        });
    });
    return () => {
      unlisten?.();
    };
  }, [openPathIntoTab]);
}
