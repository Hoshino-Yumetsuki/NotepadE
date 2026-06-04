import { FluentProvider, Button } from '@fluentui/react-components';
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
import { StatusBar } from './statusbar/StatusBar';
import { useStatusBarModel } from './statusbar/useStatusBarModel';
import { recordLastSaved, forgetEditor } from './statusbar/fileStatusTracker';
import { useSettings } from './settings/useSettings';
import { useAppTheme } from './theme/useAppTheme';
import { SettingsSurface } from './settings/SettingsSurface';
import { installSettingsTestHook } from './settings/settingsTestHook';
import { tokensForAppTheme } from './theme/tokens';
import {
  applyAdopt,
  applyRelease,
  beginTransfer,
  handleVoidDrop,
  installTransferTestHook,
  type TransferTextSource,
} from './tabs/transferWiring';

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
  // Live app theme (Phase 5, Lane C): resolves themeMode + OS theme + accent into
  // a FluentProvider theme and the active 'light'|'dark'|'hc' bucket, recomputed
  // on theme.onOsThemeChanged / theme.onAccentChanged / settings.onChanged with
  // NO reload. Replaces the Phase-2 hardcoded web{Light,Dark}Theme selection.
  const appTheme = useAppTheme();
  const resolvedTheme = appTheme.resolved;

  // Live settings bag (MAIN-owned). Shared by the settings surface, the live
  // status-bar visibility (showStatusBar), and the theme resolution above.
  const { settings, update: updateSettings } = useSettings();

  // Settings surface open/close state (entry point in the tab strip toolbar).
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

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
      // Seed the external-modification baseline (column 0) from the authoritative
      // OpenedFile mtime so a later disk change is detectable (Lane C, Gate-4).
      if (file.filePath) recordLastSaved(id, file.filePath, file.dateModifiedMs);
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

  // Cross-window transfer (Workstream 6.A). The text source reads the live CM6
  // doc for an editor (last-saved baseline == pending doc in the renderer; MAIN
  // re-validates the path) and seeds a freshly-adopted editor's document. Stable
  // ref so the subscriptions + seam below don't re-bind every render.
  const transferSource = useRef<TransferTextSource>({
    getLastSavedText: (id) =>
      editorHandles.current.get(id)?.getView()?.state.doc.toString() ?? '',
    getPendingText: (id) =>
      editorHandles.current.get(id)?.getView()?.state.doc.toString() ?? '',
    seedAdoptedDoc: (id, text) => {
      // The adopted tab's editor mounts on the next render; seed once it exists.
      const seed = (): void => {
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(text);
        else requestAnimationFrame(seed);
      };
      requestAnimationFrame(seed);
    },
  });

  // Subscribe to MAIN's adopt/release pushes (this window is a transfer target
  // and/or source). MAIN is the sole router; these only mutate the local store.
  useEffect(() => {
    const offAdopt = window.notepads.editor.onAdopt((payload) =>
      applyAdopt(store, transferSource.current, payload),
    );
    const offRelease = window.notepads.editor.onRelease(({ editorId }) =>
      applyRelease(store, editorId),
    );
    return () => {
      offAdopt();
      offRelease();
    };
  }, [store]);

  // Transfer test seam (Gate-6 harness, lane-h): drives the genuine begin/
  // complete/void-drop path since Playwright can't synthesize a real HTML5
  // cross-process drag. PA-8-clean (only window.notepads + store).
  useEffect(
    () => installTransferTestHook(store, transferSource.current),
    [store],
  );

  // App-window activation (Workstream 6.A): a broker redirect/spawn delivers the
  // file paths to open into THIS window. Open each via file.open into a new tab.
  useEffect(() => {
    const off = window.notepads.app.onActivation((event) => {
      for (const path of event.paths) {
        void window.notepads.file.open(path).then((res) => {
          if (!res.ok) return;
          const id = store.newTab({
            filePath: res.data.filePath,
            encodingId: res.data.encodingId,
            eolId: res.data.eolId,
            activate: true,
          });
          editorHandles.current.get(id)?.setDoc(res.data.decodedText);
          if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
        });
      }
    });
    return off;
  }, [store]);

  // Close a tab and drop its external-modification baseline (Lane C, Gate-4):
  // the per-editor mtime ledger must not leak across a closed editorId.
  const closeTab = useCallback(
    (id: string): void => {
      forgetEditor(id);
      store.close(id);
    },
    [store],
  );

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
    onCloseActive: (id) => closeTab(id),
  });

  // Status-bar view model (Lane C): derives the 8-column props from the active
  // tab + its live CM6 view and binds every action to window.notepads (PA-8).
  const statusModel = useStatusBarModel({
    theme: resolvedTheme,
    store,
    getActiveHandle: () =>
      store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null,
    activeEditorId,
  });

  // Settings test seam (Phase 5 Gate-5 harness): exposes open/close + the live
  // settings bag + the resolved theme bucket. PA-8-clean (no IPC). Re-installs
  // when the live values change so the getters close over current state.
  useEffect(() => {
    return installSettingsTestHook({
      open: () => setSettingsOpen(true),
      close: () => setSettingsOpen(false),
      getSettings: () => settings,
      getResolvedTheme: () => resolvedTheme,
    });
  }, [settings, resolvedTheme]);

  // Settings entry point — Ctrl+, opens the settings surface (UWP parity: the
  // app menu's Settings command). The toolbar gear (below) is the mouse path.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Window-mode wiring (Workstream 6.A): F11 toggles native fullscreen; a
  // dispatched 'notepads:toggle-compact' event toggles the compact-overlay
  // substitute (frameless always-on-top, per 0.A sign-off #8). Both route
  // through window.notepads.window (MAIN owns the BrowserWindow — PA-8). Local
  // refs track the resolved state so each toggle flips it.
  const fullScreenRef = useRef(false);
  const compactRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        e.preventDefault();
        void window.notepads.window.setFullScreen(!fullScreenRef.current).then((res) => {
          if (res.ok) fullScreenRef.current = res.data.isFullScreen;
        });
      }
    };
    const onCompact = (): void => {
      void window.notepads.window.setCompactOverlay(!compactRef.current).then((res) => {
        if (res.ok) compactRef.current = res.data.isCompactOverlay;
      });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('notepads:toggle-compact', onCompact);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('notepads:toggle-compact', onCompact);
    };
  }, []);

  return (
    <FluentProvider
      theme={appTheme.theme}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: tokensForAppTheme(resolvedTheme).base,
      }}
    >
      <TabStrip
        tabs={tabs}
        activeEditorId={activeEditorId}
        store={store}
        isDark={resolvedTheme === 'dark'}
        theme={resolvedTheme}
        onNewTab={() => store.newTab()}
        onCloseTab={(id) => closeTab(id)}
        onBeginTransfer={(id) => beginTransfer(store, transferSource.current, id)}
        onVoidDrop={(id) => handleVoidDrop(store, id)}
      />
      <div id="app-shell" style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        <Button
          appearance="subtle"
          aria-label="Open settings"
          data-testid="open-settings"
          title="Settings (Ctrl+,)"
          onClick={() => setSettingsOpen(true)}
          icon={
            <span aria-hidden style={{ fontFamily: '"Segoe MDL2 Assets"', fontSize: 16 }}>
              {String.fromCharCode(0xe713)}
            </span>
          }
          style={{ position: 'absolute', top: 6, right: 8, zIndex: 5, minWidth: 0 }}
        />
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
      {settings.showStatusBar ? <StatusBar {...statusModel} /> : null}
      <SettingsSurface
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        update={updateSettings}
        theme={appTheme.theme}
      />
    </FluentProvider>
  );
}
