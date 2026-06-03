import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keymap } from '@codemirror/view';
import type { OpenedFile } from '@shared/ipc-contract';
import { CodeMirrorEditor, type CodeMirrorHandle } from './editor/CodeMirrorEditor';
import { installTestHook, installEditorTestHook, type OpenLabels } from './editor/test-hook';
import { useFindBar } from './editor/search/useFindBar';
import { TabStrip } from './tabs/TabStrip';
import { useTabsStore, tabsStore } from './tabs/useTabsStore';
import { useTabKeyboard } from './tabs/useTabKeyboard';
import { installTabsTestHook } from './tabs/tabsTestHook';

/**
 * App shell (Phase 2). Mounts FluentProvider with the hardcoded base theme
 * (Dark #2E2E2E / Light #F0F0F0) and the SetsView TabStrip above a multi-editor
 * surface.
 *
 * Multi-editor model (docs/plan/03 task #1d): each tab owns its own live CM6
 * instance. All editors stay mounted; only the active one is visible (the others
 * are display:none), so each tab preserves its document / caret / scroll across
 * switches exactly like the UWP per-tab TextEditor instances. Closing a tab
 * unmounts its editor and frees the handle.
 *
 * Authority contract (docs/plan/04 §3.A): MAIN sends {decodedText, encodingId,
 * eolId}; the renderer normalizes decodedText into a '\n' shadow buffer and
 * keeps encodingId/eolId as OPAQUE per-tab labels — never re-derived.
 */
export function App(): JSX.Element {
  const [isDark, setIsDark] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  );
  // Forced-colors (Windows High Contrast). Drives the strip-local HC token set
  // for the Phase-2 strip (app-wide HC theming is deferred to Phase 5). The
  // golden harness toggles this via emulateMedia({ forcedColors: 'active' }).
  const [forcedColors, setForcedColors] = useState<boolean>(
    typeof window !== 'undefined' && (window.matchMedia?.('(forced-colors: active)').matches ?? false),
  );

  const { tabs, activeEditorId, store } = useTabsStore(tabsStore);

  // One CM6 handle per editorId. The active editor's handle backs the test hook.
  const editorHandles = useRef<Map<string, CodeMirrorHandle | null>>(new Map());
  // Opaque labels for the ACTIVE editor (carried back to MAIN on save).
  const labelsRef = useRef<OpenLabels>({ encodingId: null, eolId: null });

  // Find/replace host (Lane B). Reads the ACTIVE editor's live EditorView so
  // Ctrl+F/H/G + F3/Shift+F3 drive the same CM6 instance the host owns, and the
  // returned editorExtensions install the match-highlight field per editor.
  const find = useFindBar({
    getActiveView: () =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getView() ?? null)
        : null,
  });
  // Compose the find seam once: the find keymap (Ctrl+F/H/G, F3/Shift+F3, Esc)
  // plus the match-highlight StateField, mounted via CodeMirrorEditor's
  // `editorExtensions` prop (after the command keymap, before the CM6 base).
  const findEditorExtensions = useMemo(
    () => [keymap.of(find.keymap), find.editorExtensions],
    [find.keymap, find.editorExtensions],
  );

  // Seed an initial untitled tab once.
  useEffect(() => {
    if (store.count() === 0) store.newTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setIsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(forced-colors: active)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setForcedColors(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Keep labelsRef pointed at the active tab's opaque labels.
  useEffect(() => {
    if (!activeEditorId) {
      labelsRef.current = { encodingId: null, eolId: null };
      return;
    }
    const tab = store.get(activeEditorId);
    labelsRef.current = tab
      ? { encodingId: tab.encodingId, eolId: tab.eolId }
      : { encodingId: null, eolId: null };
  }, [activeEditorId, tabs, store]);

  const onFileOpened = useCallback(
    (file: OpenedFile): void => {
      const id = store.activeEditorId;
      if (!id) return;
      editorHandles.current.get(id)?.setDoc(file.decodedText);
      store.setLabels(id, file.encodingId, file.eolId);
      store.setFilePath(id, file.filePath);
      labelsRef.current = { encodingId: file.encodingId, eolId: file.eolId };
    },
    [store],
  );

  // Editor test hook reads the ACTIVE editor's handle + labels (existing Gate-1).
  useEffect(() => {
    const uninstall = installTestHook(
      () => (store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null),
      () => labelsRef.current,
      onFileOpened,
    );
    return uninstall;
  }, [onFileOpened, store]);

  // Editor-surface seam (Phase 3 Gate-3 harness): exposes the ACTIVE tab's live
  // CM6 view to the keyboard-conformance + undo-granularity e2e. PA-8-clean — it
  // reads the EditorView + public CM6 history helpers, no IPC/fs. Installed after
  // installTestHook so it attaches to the same window.__notepadsTest object.
  useEffect(() => {
    const uninstall = installEditorTestHook(() =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getView() ?? null)
        : null,
    );
    return uninstall;
  }, [store]);

  // Tabs test seam (Phase 2 matrix harness).
  useEffect(() => installTabsTestHook(store), [store]);

  // App-level tab keyboard shortcuts.
  useTabKeyboard(store, {
    onNewTab: () => store.newTab(),
    onRename: () => {
      // Inline rename is initiated in TabStrip via F2/double-click; the keyboard
      // hook only needs to route F2 there. We surface intent via a DOM event the
      // strip listens for — kept simple: focus is handled inside the strip.
      const id = store.activeEditorId;
      if (id) {
        const evt = new CustomEvent('notepads:begin-rename', { detail: { editorId: id } });
        window.dispatchEvent(evt);
      }
    },
    onCloseActive: (id) => store.close(id),
  });

  return (
    <FluentProvider
      theme={isDark ? webDarkTheme : webLightTheme}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: isDark ? '#2E2E2E' : '#F0F0F0',
      }}
    >
      <TabStrip
        tabs={tabs}
        activeEditorId={activeEditorId}
        store={store}
        isDark={isDark}
        theme={forcedColors ? 'hc' : isDark ? 'dark' : 'light'}
        onNewTab={() => store.newTab()}
        onCloseTab={(id) => store.close(id)}
      />
      <div id="app-shell" style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        {tabs.map((tab) => (
          <div
            key={tab.editorId}
            data-testid="editor-host"
            data-editor-id={tab.editorId}
            style={{
              position: 'absolute',
              inset: 0,
              display: tab.editorId === activeEditorId ? 'block' : 'none',
            }}
          >
            <CodeMirrorEditor
              ref={(h) => {
                if (h) editorHandles.current.set(tab.editorId, h);
                else editorHandles.current.delete(tab.editorId);
              }}
              editorExtensions={findEditorExtensions}
            />
          </div>
        ))}
      </div>
      {find.findBar}
    </FluentProvider>
  );
}
