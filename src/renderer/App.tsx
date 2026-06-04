import { FluentProvider, Button } from '@fluentui/react-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keymap, EditorView } from '@codemirror/view';
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
import type { TabState } from './tabs/types';
import { normalizeToShadow } from './editor/eol';
import { MarkdownPreview } from './markdown/MarkdownPreview';
import { isMarkdownPath } from './markdown/renderMarkdown';
import { DiffViewer } from './diff/DiffViewer';
import { usePrint } from './integrations/usePrint';
import { useShare } from './integrations/useShare';
import { useViewModeKeyboard } from './integrations/useViewModeKeyboard';
import { useT } from './i18n';

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
/** Tab display title: file basename (PA-8-safe split, no path import) or untitled name. */
function tabTitle(tab: TabState): string {
  if (tab.filePath) return tab.filePath.split(/[\\/]/).pop() || tab.filePath;
  return tab.untitledName || 'Untitled';
}

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

  // Live translator (Phase 6 wave 2). The settings toolbar button below is the
  // first useT() consumer: its label re-localizes on a settings.appLanguage
  // switch with NO reload (provider mounted in main.tsx). Wave-2 grows more
  // wrapped strings from here.
  const { t } = useT();

  // Settings surface open/close state (entry point in the tab strip toolbar).
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const { tabs, activeEditorId, store } = useTabsStore(tabsStore);

  // One CM6 handle per editorId. The active editor's handle backs the test hook.
  const editorHandles = useRef<Map<string, CodeMirrorHandle | null>>(new Map());
  // Opaque labels for the ACTIVE editor (carried back to MAIN on save).
  const labelsRef = useRef<OpenLabels>({ encodingId: null, eolId: null });

  // Last-saved baseline TEXT per editor (Phase 6, diff viewer). The store/tracker
  // keep only mtime, so the diff pane's "original" column needs the text captured
  // at each authoritative load point (open / activation-open / adopt). Untitled
  // buffers have no entry → '' (everything shows as an insert). Pure renderer.
  const lastSavedTextRef = useRef<Map<string, string>>(new Map());
  // A no-value re-render pulse: while a content pane (preview/diff) is open we bump
  // this on every doc change so the pane re-reads the live shadow text (CM6 owns
  // the doc, so App otherwise doesn't re-render on keystrokes).
  const [, bumpDocVersion] = useState(0);

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

  // Compose the editor extensions actually mounted: the find seam PLUS a doc-change
  // pulse that re-renders App while a content pane is open, so MarkdownPreview /
  // DiffViewer reflect live typing. The listener is a no-op when no pane is open.
  const paneEditorExtensions = useMemo(
    () => [
      ...findEditorExtensions,
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const id = tabsStore.activeEditorId;
        const vm = id ? tabsStore.get(id)?.viewMode : undefined;
        if (vm && (vm.preview || vm.diff)) bumpDocVersion((v) => v + 1);
      }),
    ],
    [findEditorExtensions],
  );

  // Content integrations (Phase 6, Lane B): print (Ctrl+P / Ctrl+Shift+P), share,
  // and the Alt+P (markdown preview) / Alt+D (diff) view-mode accelerators. The
  // toggles are mutually exclusive (turning one on clears the other).
  const print = usePrint();
  const { share } = useShare();
  useViewModeKeyboard({
    isPreviewEligible: () => {
      const id = store.activeEditorId;
      return isMarkdownPath((id ? store.get(id) : undefined)?.filePath ?? null);
    },
    togglePreview: () => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (id && t) store.setViewMode(id, { preview: !t.viewMode.preview, diff: false });
    },
    toggleDiff: () => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (id && t) store.setViewMode(id, { diff: !t.viewMode.diff, preview: false });
    },
  });

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
      // Seed the doc as soon as the editor handle is registered. Call once
      // synchronously (the handle is usually already present — the common open
      // path; setDoc itself tolerates an unmounted view via docRef), and retry
      // via setTimeout(0) ONLY while the handle is still null. NOT rAF: the
      // Playwright primary window never composites, so rAF callbacks never fire
      // and the seed would starve (it also starves a minimized/occluded window
      // in production); setTimeout fires regardless of compositing.
      const seedOpened = (): void => {
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(file.decodedText);
        else setTimeout(seedOpened, 0);
      };
      seedOpened();
      store.setLabels(id, file.encodingId, file.eolId);
      store.setFilePath(id, file.filePath);
      labelsRef.current = { encodingId: file.encodingId, eolId: file.eolId };
      // Seed the external-modification baseline (column 0) from the authoritative
      // OpenedFile mtime so a later disk change is detectable (Lane C, Gate-4).
      if (file.filePath) recordLastSaved(id, file.filePath, file.dateModifiedMs);
      // Seed the diff baseline TEXT (Phase 6) from the authoritative decoded text.
      lastSavedTextRef.current.set(id, file.decodedText);
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
      // Seed once the adopted tab's editor handle exists. setTimeout(0), not rAF:
      // rAF never fires in a non-compositing window (Playwright primary / occluded
      // window), which would starve the seed. setDoc tolerates an unmounted view.
      const seed = (): void => {
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(text);
        else setTimeout(seed, 0);
      };
      seed();
    },
  });

  // Subscribe to MAIN's adopt/release pushes (this window is a transfer target
  // and/or source). MAIN is the sole router; these only mutate the local store.
  useEffect(() => {
    const offAdopt = window.notepads.editor.onAdopt((payload) => {
      // applyAdopt re-keys the adopted tab under a FRESH local editorId (the
      // source's id can collide cross-window — Task #20). Key the diff baseline
      // by the returned local id, not payload.editorId.
      const localId = applyAdopt(store, transferSource.current, payload);
      lastSavedTextRef.current.set(localId, payload.file.decodedText);
    });
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
          // The new tab's editor mounts on a later render; seed once its handle
          // exists. Call synchronously first, then setTimeout(0)-retry while the
          // handle is null — NOT rAF, which never fires in a non-compositing
          // window (the Playwright primary window, or a minimized/occluded one)
          // and would leave the doc empty. setDoc tolerates an unmounted view.
          const seedActivation = (): void => {
            const handle = editorHandles.current.get(id);
            if (handle) handle.setDoc(res.data.decodedText);
            else setTimeout(seedActivation, 0);
          };
          seedActivation();
          if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
          lastSavedTextRef.current.set(id, res.data.decodedText);
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
      lastSavedTextRef.current.delete(id);
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

  // Print + Share (Workstream 6.B/C). Ctrl+P prints the current document and
  // Ctrl+Shift+P prints every open document (one per page); both route through the
  // print host + MAIN webContents.print(). A dispatched 'notepads:share' event
  // hands the active document to MAIN's share/clipboard path. PA-8 (typed bridge).
  useEffect(() => {
    const readText = (id: string): string =>
      editorHandles.current.get(id)?.getShadowText() ?? '';
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (e.shiftKey) {
          void print.printAll(
            store.tabs.map((t) => ({ title: tabTitle(t), text: readText(t.editorId) })),
          );
        } else {
          const id = store.activeEditorId;
          const t = id ? store.get(id) : undefined;
          if (id && t) void print.printCurrent({ title: tabTitle(t), text: readText(id) });
        }
      }
    };
    const onShare = (): void => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (id && t) void share({ title: tabTitle(t), text: readText(id) });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('notepads:share', onShare);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('notepads:share', onShare);
    };
  }, [print, share, store]);

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
          aria-label={t('MainMenu_Button_Settings.Text')}
          data-testid="open-settings"
          title={`${t('MainMenu_Button_Settings.Text')} (Ctrl+,)`}
          onClick={() => setSettingsOpen(true)}
          icon={
            <span aria-hidden style={{ fontFamily: '"Segoe MDL2 Assets"', fontSize: 16 }}>
              {String.fromCharCode(0xe713)}
            </span>
          }
          style={{ position: 'absolute', top: 6, right: 8, zIndex: 5, minWidth: 0 }}
        />
        {tabs.map((tab) => {
          const isActive = tab.editorId === activeEditorId;
          const paneOn = isActive && (tab.viewMode.preview || tab.viewMode.diff);
          // Live shadow text for the pane, re-read each render. bumpDocVersion
          // pulses a re-render while a pane is open so typing reflects live.
          const shadow = paneOn
            ? (editorHandles.current.get(tab.editorId)?.getShadowText() ?? '')
            : '';
          return (
            <div
              key={tab.editorId}
              data-testid="editor-host"
              data-editor-id={tab.editorId}
              style={{
                position: 'absolute',
                inset: 0,
                display: isActive ? 'block' : 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: paneOn ? '50%' : 0,
                }}
              >
                <CodeMirrorEditor
                  ref={(h) => {
                    if (h) editorHandles.current.set(tab.editorId, h);
                    else editorHandles.current.delete(tab.editorId);
                  }}
                  editorExtensions={paneEditorExtensions}
                />
              </div>
              {paneOn && tab.viewMode.preview && (
                <div
                  data-testid="preview-pane"
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    right: 0,
                    left: '50%',
                    overflow: 'hidden',
                    borderLeft: '1px solid rgba(128,128,128,0.4)',
                  }}
                >
                  <MarkdownPreview
                    text={shadow}
                    isDark={resolvedTheme === 'dark'}
                    fontSize={settings.editorFontSize}
                  />
                </div>
              )}
              {paneOn && tab.viewMode.diff && (
                <div
                  data-testid="diff-pane"
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    right: 0,
                    left: '50%',
                    borderLeft: '1px solid rgba(128,128,128,0.4)',
                  }}
                >
                  <DiffViewer
                    original={normalizeToShadow(lastSavedTextRef.current.get(tab.editorId) ?? '')}
                    modified={shadow}
                  />
                </div>
              )}
            </div>
          );
        })}
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
