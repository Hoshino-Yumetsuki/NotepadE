import { FluentProvider, Spinner } from '@fluentui/react-components';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { UpdateInfo } from '@shared/ipc-contract';
import { isMac } from '@shared/platform';
import { MonacoEditor, type MonacoHandle } from './editor/MonacoEditor';
import { PieceTreeLargeFileEditor } from './editor/PieceTreeLargeFileEditor';
import { useFindBar } from './editor/search/useFindBar';
import { resolveFontFamily } from './editor/fontFamily';
import { TabStrip } from './tabs/TabStrip';
import { useTabsStore, tabsStore, setUntitledBaseName } from './tabs/useTabsStore';
import { useTabKeyboard } from './tabs/useTabKeyboard';
import { StatusBar } from './statusbar/StatusBar';
import { useStatusBarModel } from './statusbar/useStatusBarModel';
import { forgetEditor } from './statusbar/fileStatusTracker';
import { useSettings } from './settings/useSettings';
import { useAppTheme } from './theme/useAppTheme';
import { appRootBackground, isWallpaperActive, wallpaperLayerStyle } from './theme/wallpaper';
import { useWallpaper } from './theme/useWallpaper';
import { edgeShadowStyle, EDGE_SHADOW_BLUR } from './theme/shadow';
import { applyAdopt, applyRelease, beginTransfer, handleVoidDrop, type TransferTextSource } from './tabs/transferWiring';
import { wordWrapToggleRef } from './editor/commands/wordWrapBridge';
import { usePrint } from './integrations/usePrint';
import { useShare } from './integrations/useShare';
import { getTabTitle } from './integrations/pathUtils';
import { useEditorContextMenu } from './editor/EditorContextMenu';
import { useViewModeKeyboard } from './integrations/useViewModeKeyboard';
import { CloseReminderDialog } from './CloseReminderDialog';
import { AppCloseReminderDialog } from './AppCloseReminderDialog';
import { UpdatePromptDialog } from './UpdatePromptDialog';
import { CaptionButtons } from './chrome/CaptionButtons';
import { useT } from './i18n';
import { usePrefersReducedMotion } from './theme/usePrefersReducedMotion';

// Extracted layout components (absolute imports / local imports relative to renderer root are absolute internally since bundler maps root to root)
import { TabSurfaceWash } from './tabs/TabSurfaceWash';
import { PaneMount } from './chrome/PaneMount';

// Extracted hooks
import { useDirtyState } from './editor/useDirtyState';
import { useFilePipeline } from './integrations/useFilePipeline';
import { useTauriWindow } from './integrations/useTauriWindow';

/**
 * Heavy secondary panes load lazily because they are hidden at first paint.
 * User-triggered mounts are wrapped in a null Suspense fallback.
 */
const MarkdownPreview = lazy(() =>
  import('./markdown/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview }))
);
const DiffViewer = lazy(() => import('./diff/DiffViewer').then((m) => ({ default: m.DiffViewer })));
const SettingsSurface = lazy(() =>
  import('./settings/SettingsSurface').then((m) => ({ default: m.SettingsSurface }))
);
const FolderSidebar = lazy(() =>
  import('./folder/FolderSidebar').then((m) => ({ default: m.FolderSidebar }))
);

/**
 * App shell. Each tab owns a live Monaco instance; inactive editors stay
 * mounted so document, caret, and scroll state survive tab switches.
 *
 * MAIN supplies decoded text plus opaque encoding/EOL labels. The renderer
 * keeps those labels per tab and edits an LF shadow buffer.
 */
export function App(): JSX.Element {
  // Live app theme (Phase 5, Lane C): resolves themeMode + OS theme + accent into
  // a FluentProvider theme and the active 'light'|'dark'|'hc' bucket, recomputed
  // on theme.onOsThemeChanged / theme.onAccentChanged / settings.onChanged with
  // NO reload. Replaces the Phase-2 hardcoded web{Light,Dark}Theme selection.
  const appTheme = useAppTheme();
  const resolvedTheme = appTheme.resolved;

  // Reduced-motion gate for the secondary-pane mount transition (C5). When the
  // user prefers reduced motion the pane renders with no animation at all.
  const reducedMotion = usePrefersReducedMotion();

  // Custom caption buttons render on every platform. Tauri uses frameless
  // windows everywhere via decorations:false in tauri.conf.json.

  // Live settings bag (MAIN-owned). Shared by the settings surface, the live
  // status-bar visibility (showStatusBar), and the theme resolution above.
  const { settings, update: updateSettings } = useSettings();

  // Custom wallpaper (web-port-only personalization). The persisted managed
  // file name doubles as the change signal (set/replace/clear all rewrite it
  // via MAIN's settings store, which broadcasts to every window); useWallpaper
  // resolves it to a data: URL. HC suppresses the layer (flat system colors).
  const wallpaperOn = isWallpaperActive(settings.wallpaperFileName, resolvedTheme);
  const wallpaperDataUrl = useWallpaper(settings.wallpaperFileName);
  // Memoized: wallpaperLayerStyle re-concatenates `url("${dataUrl}")` — for a
  // 20MB image that's a ~27MB string build + an O(n) inline-style compare on
  // EVERY App render if computed inline. Only the data URL, the slider value
  // and the selected effect actually change the style, so key on exactly those.
  const wallpaperStyle = useMemo(
    () =>
      wallpaperDataUrl
        ? wallpaperLayerStyle(wallpaperDataUrl, settings.tintOpacity, settings.wallpaperEffect)
        : null,
    [wallpaperDataUrl, settings.tintOpacity, settings.wallpaperEffect]
  );

  // Settings surface open/close state (entry point in the tab strip toolbar).
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  // Latches true the first time settings is opened. The lazy SettingsSurface is
  // only mounted once opened (so its chunk never loads at boot); we keep it mounted
  // thereafter so its own open→close slide-out animation can still play.
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
  useEffect(() => {
    if (settingsOpen) setSettingsEverOpened(true);
  }, [settingsOpen]);

  // Active tab geometry {left,width} in strip-local px (or null when there is no
  // measurable active tab — empty / scrolled out / mid-drag), reported by TabStrip.
  // Drives the single continuous wash layer below: the wash notches UP under this
  // rect so the selected tab + editor are one painted sheet (no strip→editor seam).
  const [activeTabRect, setActiveTabRect] = useState<{ left: number; width: number } | null>(null);

  const { tabs, activeEditorId, store } = useTabsStore(tabsStore);

  // Live translator — drives the localized untitled new-file base name (below).
  const { t } = useT();

  // One editor handle per editorId. Large files use Monaco's streamed Piece Tree.
  const editorHandles = useRef<Map<string, MonacoHandle | null>>(new Map());

  // Custom dirty state manager hook
  const { lastSavedTextRef, baselineRef, recomputeDirty } = useDirtyState(store, editorHandles);

  // A no-value re-render pulse: while a content pane (preview/diff) is open we
  // bump this on every doc change so the pane re-reads the live shadow text
  // (Monaco owns the doc, so App otherwise doesn't re-render on keystrokes).
  // The trailing debounce collapses bursts into one settled recompute.
  // The timer is cleared on each new change and on unmount.
  const [, bumpDocVersion] = useState(0);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable accessors for the ACTIVE editor's Monaco instance/handle. These MUST be
  // referentially stable: useStatusBarModel feeds getActiveHandle into a
  // useCallback→useEffect that runs a 250ms caret poll; an inline arrow here
  // would change identity every render, re-run that effect every render, and
  // setLineColumn(new object) → re-render → infinite update loop.
  const getActiveEditor = useCallback(
    (): monaco.editor.IStandaloneCodeEditor | null => {
      const id = store.activeEditorId;
      const tab = id ? store.get(id) : undefined;
      return id && tab && !tab.isLoading
        ? (editorHandles.current.get(id)?.getEditor() ?? null)
        : null;
    },
    [store]
  );
  const getActiveHandle = useCallback(
    () => {
      const id = store.activeEditorId;
      const tab = id ? store.get(id) : undefined;
      return id && tab && !tab.isLoading ? (editorHandles.current.get(id) ?? null) : null;
    },
    [store]
  );

  const activeEditorReadyKey = (() => {
    const id = store.activeEditorId;
    return id ? `${id}:${store.get(id)?.isLoading ? 'loading' : 'ready'}` : '';
  })();
  const isActiveEditorLoading = Boolean(
    store.activeEditorId && store.get(store.activeEditorId)?.isLoading
  );
  // Find/replace host (Lane B, Monaco). Reads the ACTIVE editor's live
  // IStandaloneCodeEditor so Ctrl+F/H/G + F3/Shift+F3 drive the same instance the
  // host owns. Find keybindings are registered INSIDE MonacoEditor.
  const find = useFindBar({ getActiveEditor, activeEditorReadyKey, isActiveEditorLoading });

  // Schedule the trailing-debounced preview/diff re-render pulse for `editorId`.
  // App re-renders while a pane is open so MarkdownPreview / DiffViewer reflect
  // live typing. A burst of keystrokes produces one recompute after typing settles.
  // Driven from each MonacoEditor's onDocChanged.
  const schedulePanePulse = useCallback((editorId: string): void => {
    const vm = tabsStore.get(editorId)?.viewMode;
    if (!vm || !(vm.preview || vm.diff)) return;
    if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => {
      pulseTimerRef.current = null;
      bumpDocVersion((v) => v + 1);
    }, 150);
  }, []);

  // Clear any pending debounced pulse on unmount so it never fires into a torn-down
  // tree (setState-after-unmount). The timer ref persists across renders, so this
  // single mount/unmount-scoped cleanup is sufficient.
  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  // Content integrations (Phase 6, Lane B): print (Ctrl+P / Ctrl+Shift+P), share,
  // and the Alt+P (markdown preview) / Alt+D (diff) view-mode accelerators. The
  // toggles are mutually exclusive (turning one on clears the other).
  const print = usePrint();
  const { share } = useShare();
  useViewModeKeyboard({
    // Preview is available for ANY file, not just the .md family — the preview
    // pane renders the buffer as markdown regardless of extension, so a .txt (or
    // untitled) buffer can be previewed too. Eligible whenever a tab is active.
    isPreviewEligible: () => store.activeEditorId != null,
    togglePreview: () => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (!id || !t) return;
      store.setViewMode(id, { preview: !t.viewMode.preview, diff: false });
    },
    toggleDiff: () => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (id && t) store.setViewMode(id, { diff: !t.viewMode.diff, preview: false });
    }
  });

  // Editor right-click context menu (UWP TextEditorContextFlyout). Attaches a
  // `contextmenu` listener to every Monaco editor (via the MonacoEditor
  // `contextMenuAttach` prop) and renders a positioned Fluent menu. Gives Share +
  // RTL their UI entry points.
  const editorContextMenu = useEditorContextMenu({
    // Preview offered for every file type (see useViewModeKeyboard above).
    isPreviewEligible: store.activeEditorId != null,
    searchEngine: settings.searchEngine,
    customSearchUrl: settings.customSearchUrl,
    onTogglePreview: () => {
      const id = store.activeEditorId;
      const tb = id ? store.get(id) : undefined;
      if (!id || !tb) return;
      store.setViewMode(id, { preview: !tb.viewMode.preview, diff: false });
    },
    onShare: (selectionOnly: boolean) => {
      const id = store.activeEditorId;
      const tb = id ? store.get(id) : undefined;
      const editor = getActiveEditor();
      const model = editor?.getModel();
      if (!tb || !editor || !model) return;
      const sel = editor.getSelection();
      const text =
        selectionOnly && sel && !sel.isEmpty()
          ? model.getValueInRange(sel, 1 /* EndOfLinePreference.LF */)
          : model.getValue(1 /* EndOfLinePreference.LF */);
      void share({ title: getTabTitle(tb), text });
    }
  });

  const { openPathIntoTab, doSave, doSaveAll } = useFilePipeline({
    store,
    editorHandles,
    lastSavedTextRef,
    baselineRef
  });

  // Open dialog (Ctrl+O + menu, UWP MainMenuButton_OpenButton): MAIN owns the
  // native picker (PA-8); we open each chosen path via the shared primitive. A
  // cancelled picker resolves ok with [] — treated as a no-op.
  const doOpen = useCallback((): void => {
    void window.notepads.file.openDialog().then((res) => {
      if (!res.ok) return;
      for (const path of res.data) openPathIntoTab(path);
    });
  }, [openPathIntoTab]);

  // Open Folder dialog (Issue #10): shows a native folder picker via MAIN,
  // sets the sidebar root path. Cancelled picker resolves ok with null/undefined.
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const doOpenFolder = useCallback((): void => {
    void window.notepads.folder.openDialog().then((res) => {
      if (res.ok && res.data) {
        setOpenFolder(res.data);
        setSidebarVisible(true);
        void window.notepads.recent.addFolder(res.data);
      }
    });
  }, []);

  // New Window (Ctrl+Shift+N + menu, UWP MenuCreateNewWindowButton): ask the
  // broker to spawn a fresh empty window. MAIN owns window lifecycle (PA-8).
  const doNewWindow = useCallback((): void => {
    void window.notepads.window.brokerRequest({ paths: [], forceNewWindow: true });
  }, []);

  // Open / New Window accelerators (match the existing Ctrl+S effect style):
  // Ctrl+O opens the native picker, Ctrl+Shift+N spawns a new window. Bare
  // chords only — Ctrl+Shift+N must not collide with Ctrl+N new-tab (which
  // requires !shift in useTabKeyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'o' || e.key === 'O')
      ) {
        e.preventDefault();
        doOpen();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        !e.altKey &&
        (e.key === 'n' || e.key === 'N')
      ) {
        e.preventDefault();
        doNewWindow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doOpen, doNewWindow]);

  // App-level close reminder dialog state
  const [appClosePending, setAppClosePending] = useState(false);

  // Set up Tauri Window listeners (Activation, Drag-drop, Window close)
  useTauriWindow({
    store,
    openPathIntoTab,
    setAppClosePending
  });

  // e.g. en 'Untitled.txt' / zh '新建文本文档.txt' / ja '無題.txt'). The store
  // appends a number ('{base} {N}'); we strip the trailing extension so the tab
  // reads e.g. "新建文本文档 1", not "新建文本文档.txt 1". Re-applied whenever the
  // resolved language changes so a switch in Settings affects the NEXT new tab.
  const untitledBase = useMemo(() => {
    const resource = t('TextEditor_DefaultNewFileName');
    return resource.replace(/\.[^.]+$/, '') || resource;
  }, [t]);
  // This effect is defined BEFORE the seed effect so it runs first on mount —
  // the initial seeded tab is already localized rather than English.
  useEffect(() => {
    setUntitledBaseName(untitledBase);
  }, [untitledBase]);

  // Seed an initial untitled tab once (after the base name is set above).
  // Deferred by one microtask so the activation listener (Effect below) has a
  // chance to drain cold-start file-association events first. If an activation
  // opens a file tab, store.count() > 0 and no blank tab is created — preventing
  // the orphan blank tab alongside the opened file (Issue #6).
  useEffect(() => {
    queueMicrotask(() => {
      if (store.count() === 0) store.newTab();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Cross-window transfer source: the saved baseline and pending editor text
  // travel with the tab; adopted tabs receive a fresh editor and undo history.
  const transferSource = useRef<TransferTextSource>({
    getLastSavedText: (id) => lastSavedTextRef.current.get(id) ?? '',
    getPendingText: (id) => editorHandles.current.get(id)?.getShadowText() ?? '',
    seedAdoptedDoc: (id, text) => {
      // Seed once the adopted tab's editor handle exists. setTimeout(0) also
      // works in minimized or occluded windows where rAF may not run.
      const seed = (): void => {
        // Stop if the adopted tab was closed before its editor registered.
        if (!tabsStore.get(id)) return;
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(text);
        else setTimeout(seed, 0);
      };
      seed();
    }
  });

  // Subscribe to MAIN's adopt/release pushes; MAIN is the sole router and these
  // callbacks only mutate this window's local store and baselines.
  useEffect(() => {
    const offAdopt = window.notepads.editor.onAdopt((payload) => {
      // The source id can collide with a local tab, so key baselines by the
      // freshly minted local id returned from applyAdopt.
      const localId = applyAdopt(store, transferSource.current, payload);
      lastSavedTextRef.current.set(localId, payload.file.decodedText);
      baselineRef.current.set(localId, {
        hash: payload.file.baselineHash,
        length: payload.file.baselineLength
      });
    });
    const offRelease = window.notepads.editor.onRelease(({ editorId }) =>
      applyRelease(store, editorId)
    );
    return () => {
      offAdopt();
      offRelease();
    };
  }, [store, lastSavedTextRef, baselineRef]);
  // Actually remove a tab and drop its external-modification baseline (Lane C,
  // Gate-4): the per-editor mtime ledger must not leak across a closed editorId.
  // Then enforce the last-tab behavior (Issue 4, UWP NotepadsMainPage.xaml.cs:
  // 496-602): after any close empties the strip, ON → quit the app, OFF → seed a
  // fresh untitled so the window is never left blank. Callers gate dirty tabs
  // behind the close-reminder dialog, so by the time we get here the user has
  // already chosen Save or Don't Save — no unsaved work is silently dropped.
  const performClose = useCallback(
    (id: string): void => {
      forgetEditor(id);
      lastSavedTextRef.current.delete(id);
      baselineRef.current.delete(id);
      store.close(id);
      if (store.count() === 0) {
        if (settings.exitWhenLastTabClosed) void window.notepads.window.quit();
        else store.newTab();
      }
    },
    [store, settings.exitWhenLastTabClosed, lastSavedTextRef, baselineRef]
  );

  // Sweep per-editor side maps for tabs that left the store via paths that do
  // NOT go through performClose — closeOthers / closeToRight / closeSaved (the
  // tab context menu calls the store directly), cross-window release, void-drop.
  // Without this, lastSavedTextRef keeps each closed tab's FULL baseline text
  // alive forever (a closed 100MB file retained ~100MB of heap — measured), and
  // the file-status tracker leaks its mtime entry. Runs on every tabs-snapshot
  // change; the live-id set build is O(tabs) and the maps are tiny (one entry
  // per ever-open editor), so the sweep cost is negligible.
  useEffect(() => {
    const live = new Set(tabs.map((t) => t.editorId));
    for (const id of Array.from(lastSavedTextRef.current.keys())) {
      if (!live.has(id)) {
        lastSavedTextRef.current.delete(id);
        baselineRef.current.delete(id);
        forgetEditor(id);
      }
    }
  }, [tabs, lastSavedTextRef, baselineRef]);

  // Close-reminder dialog state (Issue 4, UWP SetCloseSaveReminderDialog). Non-null
  // while a MODIFIED tab is awaiting the user's Save / Don't Save / Cancel choice.
  const [pendingClose, setPendingClose] = useState<{ editorId: string; fileName: string } | null>(
    null
  );

  // Close a tab. With exitWhenLastTabClosed OFF, closing the sole PRISTINE untitled
  // tab is refused (the window keeps one empty buffer). A MODIFIED tab routes
  // through the save-reminder dialog (no silent data loss); a clean tab closes
  // immediately via performClose.
  const closeTab = useCallback(
    (id: string): void => {
      const tab = store.get(id);
      if (!tab) return;
      const exitOnLast = settings.exitWhenLastTabClosed;
      const isLast = store.count() === 1;
      const pristineUntitled = !tab.filePath && !tab.isModified;
      // Guard: refuse to close the sole pristine untitled tab when not exiting.
      if (!exitOnLast && isLast && pristineUntitled) return;

      if (tab.isModified) {
        setPendingClose({ editorId: id, fileName: getTabTitle(tab) });
        return;
      }
      performClose(id);
    },
    [store, settings.exitWhenLastTabClosed, performClose]
  );

  // Stable TabStrip callback identities. SortableTab is React.memo'd; if these were
  // fresh inline closures (minted on every App render — App re-renders on EVERY
  // store mutation via useSyncExternalStore), the memo comparator would always see
  // changed handler props and re-render ALL tabs on any setModified/setCaret/etc.
  // Wrapping them in useCallback lets the memo actually skip unrelated tabs.
  const onNewTab = useCallback(() => store.newTab(), [store]);
  const onBeginTransfer = useCallback(
    (id: string) => beginTransfer(store, transferSource.current, id),
    [store]
  );
  const onVoidDrop = useCallback((id: string) => handleVoidDrop(store, id), [store]);

  // Close-reminder dialog outcomes (Issue 4, UWP SetCloseSaveReminderDialog).
  // Save → write, then close only if the write succeeded (a cancelled Save-As
  // picker aborts the close, keeping the tab). Don't Save → discard + close.
  // Cancel / dismiss → keep the tab. Each clears the pending state first so the
  // dialog closes before the (possibly async) save resolves.
  const onReminderSave = useCallback((): void => {
    const target = pendingClose;
    if (!target) return;
    setPendingClose(null);
    void doSave(target.editorId).then((saved) => {
      if (saved) performClose(target.editorId);
    });
  }, [pendingClose, doSave, performClose]);
  const onReminderDontSave = useCallback((): void => {
    const target = pendingClose;
    if (!target) return;
    setPendingClose(null);
    performClose(target.editorId);
  }, [pendingClose, performClose]);
  const onReminderCancel = useCallback((): void => setPendingClose(null), []);

  // Save All & Exit: save every modified tab in turn (a cancelled Save-As picker or
  // a write error aborts), then close the window only if everything is now clean.
  const onAppCloseSaveAll = useCallback((): void => {
    setAppClosePending(false);
    void (async () => {
      for (const t of store.tabs) {
        if (t.isModified && !(await doSave(t.editorId))) return; // aborted — stay open.
      }
      void window.notepads.window.confirmClose();
    })();
  }, [store, doSave]);

  const onAppCloseDiscard = useCallback((): void => {
    setAppClosePending(false);
    void window.notepads.window.confirmClose();
  }, []);

  const onAppCloseCancel = useCallback((): void => setAppClosePending(false), []);

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
    onCloseActive: (id) => closeTab(id)
  });

  // Status-bar view model (Lane C): derives the 8-column props from the active
  // tab + its live Monaco view and binds every action to window.notepads (PA-8).
  const statusModel = useStatusBarModel({
    theme: resolvedTheme,
    store,
    getActiveHandle,
    activeEditorId
  });


  // Startup auto-update check: after a 5s delay (avoid contention with cold-
  // start IO), read settings and, if autoCheckUpdates is on, call update_check.
  // Shows a dialog once per session if a new version is found.
  const [updatePromptOpen, setUpdatePromptOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const startupCheckDone = useRef(false);
  useEffect(() => {
    if (startupCheckDone.current) return;
    if (!('__TAURI_INTERNALS__' in window)) return;
    startupCheckDone.current = true;
    const timer = setTimeout(() => {
      void window.notepads.settings.get().then((r) => {
        if (!r.ok || !r.data.autoCheckUpdates) return;
        void window.notepads.updates.check().then((ur) => {
          if (ur.ok && ur.data.available) {
            setUpdateInfo(ur.data);
            setUpdatePromptOpen(true);
          }
        });
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

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

  // Print and share. Ctrl+P prints the current document; Ctrl+Shift+P prints
  // every open document, one per page. Printing uses the renderer's print host;
  // sharing uses the typed bridge after the local share event is dispatched.
  const doPrintCurrent = useCallback((): void => {
    const id = store.activeEditorId;
    const t = id ? store.get(id) : undefined;
    if (id && t) {
      void print.printCurrent(
        {
          title: getTabTitle(t),
          text: editorHandles.current.get(id)?.getShadowText() ?? ''
        },
        settings.editorFontFamily
      );
    }
  }, [print, store, settings.editorFontFamily]);
  const doPrintAll = useCallback((): void => {
    void print.printAll(
      store.tabs.map((t) => ({
        title: getTabTitle(t),
        text: editorHandles.current.get(t.editorId)?.getShadowText() ?? ''
      })),
      settings.editorFontFamily
    );
  }, [print, store, settings.editorFontFamily]);
  useEffect(() => {
    const readText = (id: string): string => editorHandles.current.get(id)?.getShadowText() ?? '';
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (e.shiftKey) doPrintAll();
        else doPrintCurrent();
      }
    };
    const onShare = (): void => {
      const id = store.activeEditorId;
      const t = id ? store.get(id) : undefined;
      if (id && t) void share({ title: getTabTitle(t), text: readText(id) });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('notepads:share', onShare);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('notepads:share', onShare);
    };
  }, [doPrintCurrent, doPrintAll, share, store]);

  // Save accelerators (Issue 3): Ctrl+S saves the active tab (untitled → picker),
  // Ctrl+Shift+S always Save-As. Matches the existing F11 / Ctrl+P effect style.
  // Re-binds when doSave/doSaveAll change identity (store-bound, so rarely).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const id = store.activeEditorId;
        if (!id) return;
        if (e.shiftKey) void doSave(id, { saveAs: true });
        else void doSave(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave, store]);

  // Each entry reuses the same handler the keyboard accelerators already drive:
  // New, Open, New Window, Find/Replace, Print, Settings, and Save actions.
  // onOpenRecent feeds the TabStrip Open Recent submenu (it fetches recent.list
  // when the flyout opens).
  const menuCommands = useMemo(
    () => ({
      onNew: () => store.newTab(),
      onFind: () => find.keymapCallbacks.openFindBar(false),
      onReplace: () => find.keymapCallbacks.openFindBar(true),
      onPrint: doPrintCurrent,
      onPrintAll: doPrintAll,
      onSettings: () => setSettingsOpen(true),
      // Save / Save As / Save All — drive the same doSave/doSaveAll the Ctrl+S /
      // Ctrl+Shift+S accelerators use. Providing these auto-enables the matching
      // disabled={!commands.onSave...} MenuItems in TabStrip (no TabStrip edit).
      onSave: () => {
        const id = store.activeEditorId;
        if (id) void doSave(id);
      },
      onSaveAs: () => {
        const id = store.activeEditorId;
        if (id) void doSave(id, { saveAs: true });
      },
      onSaveAll: () => {
        void doSaveAll();
      },
      // Open dialog (Ctrl+O) + New Window (Ctrl+Shift+N) — drive the same
      // doOpen/doNewWindow the accelerators use. Providing these auto-enables the
      // matching disabled={!commands.onOpen/onNewWindow} MenuItems in TabStrip.
      onOpen: doOpen,
      onOpenFolder: doOpenFolder,
      onNewWindow: doNewWindow,
      // Open Recent submenu (TabStrip fetches the list on flyout open via
      // recent.list and opens each entry via this shared primitive).
      onOpenRecent: openPathIntoTab,
      onOpenRecentFolder: (path: string) => {
        setOpenFolder(path);
        setSidebarVisible(true);
      },
      onTogglePreview: () => {
        const id = store.activeEditorId;
        const tb = id ? store.get(id) : undefined;
        if (!id || !tb) return;
        store.setViewMode(id, { preview: !tb.viewMode.preview, diff: false });
      },
      onToggleDiff: () => {
        const id = store.activeEditorId;
        const tb = id ? store.get(id) : undefined;
        if (id && tb) store.setViewMode(id, { diff: !tb.viewMode.diff, preview: false });
      }
    }),
    [
      store,
      find.keymapCallbacks,
      doPrintCurrent,
      doPrintAll,
      doSave,
      doSaveAll,
      doOpen,
      doOpenFolder,
      doNewWindow,
      openPathIntoTab
    ]
  );

  // Map the MAIN-owned persisted Settings bag onto the editor-behavior settings
  // MonacoEditor consumes (forwarded to the command wiring).
  const editorBehaviorSettings = useMemo(
    () => ({
      tabAsSpaces: settings.tabIndents,
      smartCopy: settings.smartCopy,
      searchEngine: settings.searchEngine,
      customSearchUrl: settings.customSearchUrl,
      fontSize: settings.editorFontSize
    }),
    [
      settings.tabIndents,
      settings.smartCopy,
      settings.searchEngine,
      settings.customSearchUrl,
      settings.editorFontSize
    ]
  );
  // word-wrap derives from the persisted TextWrapMode ('wrap' | 'noWrap').
  const editorWordWrap = settings.textWrapping === 'wrap';

  // Word wrap is a single GLOBAL preference (UWP TextWrapping is an app setting,
  // not per-document). Bridge the in-editor toggle to flip persisted
  // `textWrapping`, applying it to every open editor and surviving restarts.
  const toggleWordWrapGlobal = useCallback(() => {
    updateSettings({ textWrapping: settings.textWrapping === 'wrap' ? 'noWrap' : 'wrap' });
  }, [settings.textWrapping, updateSettings]);
  useEffect(() => {
    wordWrapToggleRef.current = toggleWordWrapGlobal;
    return () => {
      wordWrapToggleRef.current = null;
    };
  }, [toggleWordWrapGlobal]);

  return (
    <FluentProvider
      theme={appTheme.theme}
      className={`np-theme-transition${isMac ? ' np-mac' : ''}`}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        // Own stacking context so the negative-z wallpaper layer paints above
        // this background but below ALL in-flow content (theme/wallpaper.ts).
        isolation: 'isolate',
        // Wallpaper active → opaque theme base (the image replaces the desktop
        // see-through backdrop); else the historical translucent tint whose
        // alpha is tintOpacity (over the OS acrylic/vibrancy material).
        backgroundColor: appRootBackground(resolvedTheme, settings.tintOpacity, wallpaperOn)
      }}
    >
      {/* Custom wallpaper layer (web-port-only personalization): a full-window
          image UNDER every UI surface, replacing the acrylic/vibrancy desktop
          sample. While active, the SAME tintOpacity slider drives THIS layer's
          selected effect — BLUR intensity or layer OPACITY, per the
          wallpaperEffect setting — instead of the background tint alpha (the
          "Background Tint Opacity" semantics switch — see theme/wallpaper.ts). */}
      {wallpaperOn && wallpaperStyle ? (
        <div data-testid="app-wallpaper" aria-hidden style={wallpaperStyle} />
      ) : null}
      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        {openFolder && sidebarVisible ? (
          <Suspense fallback={null}>
            <FolderSidebar
              folderPath={openFolder}
              theme={resolvedTheme}
              onOpenFile={openPathIntoTab}
              onClose={() => setSidebarVisible(false)}
            />
          </Suspense>
        ) : null}
        <div
          style={{
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0
          }}
        >
          <TabStrip
            tabs={tabs}
            activeEditorId={activeEditorId}
            store={store}
            isDark={resolvedTheme === 'dark'}
            theme={resolvedTheme}
            onNewTab={onNewTab}
            onCloseTab={closeTab}
            onBeginTransfer={onBeginTransfer}
            onVoidDrop={onVoidDrop}
            menu={menuCommands}
            captionSlot={<CaptionButtons theme={resolvedTheme} />}
            onActiveTabGeometry={setActiveTabRect}
          />
          <div
            id="app-shell"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              position: 'relative',
              // The editor region itself is transparent — its surface is painted by the
              // single continuous wash layer below (the inverted-T <TabSurfaceWash/>),
              // NOT by a background here. Previously this carried the same headerSelected
              // wash the selected tab did; two separate translucent layers meeting at the
              // strip→editor line rounded to a 1px seam on fractional DPI (the "接缝" the
              // user flagged). One shared layer makes that boundary internal to a single
              // paint, so there is physically no seam at any scaling factor.
              background: 'transparent'
            }}
          >
            {/* Single continuous wash sheet (UWP SetsView selected-tab brush == content
            brush). One absolutely-positioned layer that fills the editor band AND
            extends UP under the active tab as a notch (clipped into an inverted-T),
            so the selected tab and the editor are literally one painted surface —
            no seam. Sits BELOW the editor hosts (zIndex 0; the Monaco surface is
            transparent and shows it through) and below the transparent strip above
            (which shows the notch through under the active tab). Retracts to a plain
            band when no tab is measurable (empty / scrolled out / mid-drag). */}
            <TabSurfaceWash rect={activeTabRect} theme={resolvedTheme} />
            {/* Status-bar elevation caster (status bar lifts onto the editor from
            below). The tab-strip 'down' caster was removed: it drew a full-width
            shadow line across the WHOLE strip→editor boundary, which separated the
            selected tab from the content instead of merging them. The selected
            tab's own left/right box-shadow now provides its elevation (TabStrip),
            and the shared wash above seals the seam. */}
            {settings.showStatusBar ? (
              <div
                data-testid="status-bar-shadow"
                aria-hidden
                style={edgeShadowStyle(resolvedTheme, 'up')}
              />
            ) : null}
            {tabs.map((tab) => {
              const isActive = tab.editorId === activeEditorId;
              const paneOn =
                isActive && !tab.largeFile && (tab.viewMode.preview || tab.viewMode.diff);
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
                    // Above the TabSurfaceWash (zIndex 0) so the editor content paints
                    // over the shared wash (the Monaco surface is transparent, so the wash
                    // still reads through as the editor background).
                    zIndex: 1
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 0,
                      // Preview is a SIDE-BY-SIDE split (editor left 50%, preview right
                      // 50%). Diff, by contrast, REPLACES the editor (UWP
                      // OpenSideBySideDiffViewer zeroes the editor row + disables it):
                      // the DiffViewer is itself two scroll-synced columns, so leaving
                      // the editor visible beside it produced THREE columns. Hide the
                      // editor for diff so the viewer's own two panes are the only split.
                      right: tab.viewMode.preview ? '50%' : 0,
                      display: tab.viewMode.diff ? 'none' : 'block'
                    }}
                  >
                    {tab.largeFile && tab.filePath ? (
                      <PieceTreeLargeFileEditor
                        key={tab.largeFile.streamId}
                        ref={(h) => {
                          if (h) editorHandles.current.set(tab.editorId, h);
                          else editorHandles.current.delete(tab.editorId);
                        }}
                        path={tab.filePath}
                        size={tab.largeFile.size}
                        encodingId={tab.largeFile.encodingId}
                        streamId={tab.largeFile.streamId}
                        onLoadComplete={(baseline) => {
                          baselineRef.current.set(tab.editorId, {
                            hash: baseline.baselineHash,
                            length: baseline.baselineLength
                          });
                          store.setLabels(tab.editorId, tab.encodingId, baseline.eolId);
                          store.setLoading(tab.editorId, false);
                        }}
                        onLoadError={() => store.setLoading(tab.editorId, false)}
                        onDocChanged={() => {
                          store.setModified(tab.editorId, true);
                          schedulePanePulse(tab.editorId);
                        }}
                        findCallbacks={find.keymapCallbacks}
                        contextMenuAttach={editorContextMenu.attach}
                        settings={editorBehaviorSettings}
                        lineNumbers={settings.displayLineNumbers}
                        lineHighlighter={settings.displayLineHighlighter}
                        wordWrap={editorWordWrap}
                        direction="ltr"
                        fontFamily={settings.editorFontFamily}
                        fontSize={settings.editorFontSize}
                        accentColor={appTheme.accentHex}
                        themeMode={appTheme.resolved}
                      />
                    ) : (
                      <div style={{ height: '100%', position: 'relative' }}>
                        <MonacoEditor
                          ref={(h) => {
                            if (h) editorHandles.current.set(tab.editorId, h);
                            else editorHandles.current.delete(tab.editorId);
                          }}
                          initialDoc={lastSavedTextRef.current.get(tab.editorId) ?? ''}
                          readOnly={tab.isLoading}
                          onDocChanged={() => {
                            recomputeDirty(tab.editorId);
                            schedulePanePulse(tab.editorId);
                          }}
                          findCallbacks={find.keymapCallbacks}
                          contextMenuAttach={editorContextMenu.attach}
                          settings={editorBehaviorSettings}
                          lineNumbers={settings.displayLineNumbers}
                          lineHighlighter={settings.displayLineHighlighter}
                          wordWrap={editorWordWrap}
                          direction="ltr"
                          fontFamily={settings.editorFontFamily}
                          fontSize={settings.editorFontSize}
                          accentColor={appTheme.accentHex}
                          themeMode={appTheme.resolved}
                        />
                        {tab.isLoading ? (
                          <div
                            data-testid="editor-loading"
                            aria-label="Loading file"
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'transparent',
                              pointerEvents: 'all'
                            }}
                          >
                            <Spinner size="large" />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                  {paneOn && tab.viewMode.preview && (
                    <div
                      data-testid="preview-pane"
                      style={{
                        position: 'absolute',
                        top: 0,
                        // Clear the status-bar elevation caster (an absolute 6px
                        // gradient at #app-shell's bottom, zIndex 2) so it never paints
                        // over the preview's last text row. The editor's own scroller
                        // tolerates scrolling under it, but the static preview needs the
                        // inset or its bottom strip is unreadable.
                        bottom: settings.showStatusBar ? EDGE_SHADOW_BLUR : 0,
                        right: 0,
                        left: '50%',
                        overflow: 'hidden',
                        borderLeft: '1px solid rgba(128,128,128,0.4)'
                      }}
                    >
                      <Suspense fallback={null}>
                        <PaneMount reduced={reducedMotion}>
                          <MarkdownPreview
                            text={shadow}
                            isDark={resolvedTheme === 'dark'}
                            fontSize={settings.editorFontSize}
                            strictLineBreaks={settings.strictLineBreaks}
                            editor={editorHandles.current.get(tab.editorId)?.getEditor() ?? null}
                          />
                        </PaneMount>
                      </Suspense>
                    </div>
                  )}
                  {paneOn && tab.viewMode.diff && (
                    <div
                      data-testid="diff-pane"
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: settings.showStatusBar ? EDGE_SHADOW_BLUR : 0,
                        right: 0,
                        // Diff REPLACES the editor (see the editor wrapper above): it
                        // spans the full width so the DiffViewer's two internal columns
                        // are the entire side-by-side view — not a third column beside a
                        // still-visible editor.
                        left: 0
                      }}
                    >
                      <Suspense fallback={null}>
                        <PaneMount reduced={reducedMotion}>
                          <DiffViewer
                            // Baseline entries are stored already '\n'-normalized
                            // (lastSavedTextRef invariant) — no per-render normalize.
                            original={lastSavedTextRef.current.get(tab.editorId) ?? ''}
                            modified={shadow}
                            // Match the editor's resolved font (empty setting → system
                            // stack with a CJK-safe chain) so the diff doesn't fall back
                            // to Consolas → 宋体 for non-Latin text.
                            fontFamily={resolveFontFamily(settings.editorFontFamily)}
                            fontSize={settings.editorFontSize}
                          />
                        </PaneMount>
                      </Suspense>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Find/replace bar — floats top-right OVER the editor region (UWP
            placeholder placement). Mounted INSIDE #app-shell (position:relative)
            so its absolute top-right offsets anchor to the editor region, and it
            overlays content instead of docking at the window bottom. */}
            {find.findBar}
          </div>
          {settings.showStatusBar ? (
            <StatusBar
              {...statusModel}
              folderPath={openFolder}
              onToggleFolder={() => setSidebarVisible((v) => !v)}
            />
          ) : null}
        </div>
      </div>
      {/* Settings surface is lazy-loaded; only MOUNT it once the user has opened
          it, so its chunk (4 panes) never loads on a cold start. SettingsSurface
          internally renders null while closed, so gating on settingsOpen is
          behavior-preserving — the only difference is the chunk loads on first
          open instead of at boot. Kept mounted after the first open so its own
          open→close slide-out animation still plays. */}
      {settingsOpen || settingsEverOpened ? (
        <Suspense fallback={null}>
          <SettingsSurface
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            settings={settings}
            update={updateSettings}
            theme={appTheme.theme}
            resolvedTheme={resolvedTheme}
          />
        </Suspense>
      ) : null}
      <CloseReminderDialog
        pending={pendingClose}
        theme={resolvedTheme}
        onSave={onReminderSave}
        onDontSave={onReminderDontSave}
        onCancel={onReminderCancel}
      />
      <AppCloseReminderDialog
        open={appClosePending}
        theme={resolvedTheme}
        onSaveAllAndExit={onAppCloseSaveAll}
        onDiscardAndExit={onAppCloseDiscard}
        onCancel={onAppCloseCancel}
      />
      <UpdatePromptDialog
        open={updatePromptOpen}
        info={updateInfo}
        onInstall={() => {
          setUpdatePromptOpen(false);
          if (updateInfo)
            void window.notepads.updates.install(
              updateInfo.assetUrl,
              updateInfo.assetName,
              updateInfo.htmlUrl
            );
        }}
        onDismiss={() => setUpdatePromptOpen(false)}
      />
      {editorContextMenu.menu}
    </FluentProvider>
  );
}
