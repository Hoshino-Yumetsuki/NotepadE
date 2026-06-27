import { FluentProvider, Spinner } from '@fluentui/react-components';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { OpenedFile, UpdateInfo } from '@shared/ipc-contract';
import { isMac } from '@shared/platform';
import { MonacoEditor, type MonacoHandle } from './editor/MonacoEditor';
import { installTestHook, installEditorTestHook, type OpenLabels } from './editor/test-hook';
import { useFindBar } from './editor/search/useFindBar';
import { resolveFontFamily } from './editor/fontFamily';
import { TabStrip } from './tabs/TabStrip';
import { useTabsStore, tabsStore, setUntitledBaseName } from './tabs/useTabsStore';
import { useTabKeyboard } from './tabs/useTabKeyboard';
import { installTabsTestHook } from './tabs/tabsTestHook';
import { StatusBar } from './statusbar/StatusBar';
import { useStatusBarModel } from './statusbar/useStatusBarModel';
import { recordLastSaved, forgetEditor } from './statusbar/fileStatusTracker';
import { useSettings } from './settings/useSettings';
import { useAppTheme } from './theme/useAppTheme';
import { installSettingsTestHook } from './settings/settingsTestHook';
import { appRootBackground, isWallpaperActive, wallpaperLayerStyle } from './theme/wallpaper';
import { useWallpaper } from './theme/useWallpaper';
import { edgeShadowStyle, EDGE_SHADOW_BLUR } from './theme/shadow';
import {
  applyAdopt,
  applyRelease,
  beginTransfer,
  handleVoidDrop,
  installTransferTestHook,
  type TransferTextSource
} from './tabs/transferWiring';
import type { TabState } from './tabs/types';
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
 * Heavy secondary panes loaded LAZILY (cold-start win, visually transparent):
 * none are visible at first paint — they mount only on a user action (Alt+P /
 * Alt+D / Ctrl+,). Splitting them out pulls the MarkdownPreview chunk, the diff
 * package (DiffViewer), and the four settings panes (SettingsSurface) out of
 * the first-paint chunk. Each is a NAMED export, so React.lazy gets a
 * synthesized default. Their mount sites are wrapped in <Suspense
 * fallback={null}> — a one-frame async on a user-triggered mount is
 * imperceptible, so there is zero visible change.
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
  return getTabTitle(tab);
}

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

  // Custom caption buttons render on ALL platforms (unified Windows design).
  // Electron's isFrameless gating (Windows/Mac only) is removed — Tauri enables
  // frameless windows everywhere via decorations:false in tauri.conf.json.

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

  // One Monaco handle per editorId. The active editor's handle backs the test hook.
  const editorHandles = useRef<Map<string, MonacoHandle | null>>(new Map());
  // Opaque labels for the ACTIVE editor (carried back to MAIN on save).
  const labelsRef = useRef<OpenLabels>({ encodingId: null, eolId: null });

  // Custom dirty state manager hook
  const { lastSavedTextRef, baselineRef, recomputeDirty } = useDirtyState(store, editorHandles);

  // A no-value re-render pulse: while a content pane (preview/diff) is open we bump
  // this on every doc change so the pane re-reads the live shadow text (CM6 owns
  // the doc, so App otherwise doesn't re-render on keystrokes). The bump is
  // DEBOUNCED (B1) — see paneEditorExtensions below — so a burst of keystrokes
  // collapses to ~one re-render after typing settles instead of one per keystroke
  // (the markdown + diff recompute were the two HIGH jank hotspots). This timer
  // holds the pending trailing pulse; it is cleared on each new change and on
  // unmount so no stray bump fires into a torn-down tree.
  const [, bumpDocVersion] = useState(0);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable accessors for the ACTIVE editor's Monaco instance/handle. These MUST be
  // referentially stable: useStatusBarModel feeds getActiveHandle into a
  // useCallback→useEffect that runs a 250ms caret poll; an inline arrow here
  // would change identity every render, re-run that effect every render, and
  // setLineColumn(new object) → re-render → infinite update loop.
  const getActiveEditor = useCallback(
    (): monaco.editor.IStandaloneCodeEditor | null =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getEditor() ?? null)
        : null,
    [store]
  );
  const getActiveHandle = useCallback(
    () => (store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null),
    [store]
  );

  // Find/replace host (Lane B, Monaco). Reads the ACTIVE editor's live
  // IStandaloneCodeEditor so Ctrl+F/H/G + F3/Shift+F3 drive the same instance the
  // host owns. Find keybindings are registered INSIDE MonacoEditor (via the
  // findCallbacks prop → registerFindKeybindings); highlights apply through
  // deltaDecorations directly on the editor. No CM6 extension array.
  const find = useFindBar({ getActiveEditor });

  // Schedule the trailing-debounced preview/diff re-render pulse for `editorId`.
  // While a pane is open App must re-render so MarkdownPreview / DiffViewer reflect
  // live typing (Monaco owns the doc; App doesn't otherwise re-render per keystroke).
  // TRAILING-DEBOUNCED ~150ms (B1): each doc change reschedules the single pending
  // timer, so a run of keystrokes fires at most one bump ~150ms after typing settles
  // — identical final output, far fewer markdown/diff recomputes. Only pulses while
  // THAT tab has a preview/diff pane open (gating preserved from the old CM6
  // updateListener). Driven from each MonacoEditor's onDocChanged. pulseTimerRef /
  // bumpDocVersion are declared above.
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
      void share({ title: tabTitle(tb), text });
    }
  });

  // File loading and saving pipeline hook
  const { openPathIntoTab, doSave, doSaveAll } = useFilePipeline({
    store,
    editorHandles,
    lastSavedTextRef,
    baselineRef,
    recomputeDirty
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
      // Normalize ONCE here and feed the same string to the baseline AND setDoc
      // (on already-'\n' input setDoc's internal normalize has no matches and —
      // in V8, which returns the receiver from a no-match String.replace — builds
      // no second full-size copy; that's an engine behavior, not ECMAScript spec,
      // but Electron pins V8. Matters on >100MB files).
      const normalized = file.decodedText;
      const seedOpened = (): void => {
        // Liveness abort: if the tab closed before its editor handle registered,
        // stop retrying — an orphaned loop would spin forever, retaining the
        // full doc string (same guard as openPathIntoTab's seed loop).
        if (!store.get(id)) return;
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(normalized);
        else setTimeout(seedOpened, 0);
      };
      // Seed the diff/dirty baseline TEXT (Phase 6 + Issue 3) BEFORE setDoc: the
      // setDoc dispatch fires the doc-change listener → recomputeDirty, which must
      // read the just-loaded text as the baseline so an open is "clean", not dirty.
      lastSavedTextRef.current.set(id, normalized);
      baselineRef.current.set(id, { hash: file.baselineHash, length: file.baselineLength });
      seedOpened();
      store.setLabels(id, file.encodingId, file.eolId);
      store.setFilePath(id, file.filePath);
      labelsRef.current = { encodingId: file.encodingId, eolId: file.eolId };
      // Seed the external-modification baseline (column 0) from the authoritative
      // OpenedFile mtime so a later disk change is detectable (Lane C, Gate-4).
      if (file.filePath) recordLastSaved(id, file.filePath, file.dateModifiedMs);
    },
    [store, lastSavedTextRef, baselineRef, labelsRef]
  );

  // Editor test hook reads the ACTIVE editor's handle + labels (existing Gate-1).
  useEffect(() => {
    const uninstall = installTestHook(
      () =>
        store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null,
      () => labelsRef.current,
      onFileOpened
    );
    return uninstall;
  }, [onFileOpened, store]);

  // Editor-surface seam (Phase 3 Gate-3 harness): exposes the ACTIVE tab's live
  // Monaco editor to the keyboard-conformance + undo-granularity e2e. PA-8-clean —
  // it reads the IStandaloneCodeEditor + public Monaco APIs, no IPC/fs. Installed
  // after installTestHook so it attaches to the same window.__notepadsTest object.
  useEffect(() => {
    const uninstall = installEditorTestHook(() =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getEditor() ?? null)
        : null
    );
    return uninstall;
  }, [store]);

  // Tabs test seam (Phase 2 matrix harness).
  useEffect(() => installTabsTestHook(store), [store]);

  // Cross-window transfer (Workstream 6.A). The text source reads the TRUE
  // last-saved baseline from lastSavedTextRef (NOT the live doc — for a dirty
  // tab baseline B ≠ doc D, and the adopted window re-derives isModified by
  // comparing them; shipping D as the baseline would stomp the dirty flag) and
  // the live CM6 doc as the pending text, and seeds a freshly-adopted editor's
  // document. Stable ref so the subscriptions + seam below don't re-bind every
  // render.
  const transferSource = useRef<TransferTextSource>({
    getLastSavedText: (id) => lastSavedTextRef.current.get(id) ?? '',
    getPendingText: (id) => editorHandles.current.get(id)?.getShadowText() ?? '',
    seedAdoptedDoc: (id, text) => {
      // Seed once the adopted tab's editor handle exists. setTimeout(0), not rAF:
      // rAF never fires in a non-compositing window (Playwright primary / occluded
      // window), which would starve the seed. setDoc tolerates an unmounted view.
      const seed = (): void => {
        // Liveness abort: if the adopted tab was closed before its editor
        // handle registered, stop retrying — an orphaned loop would spin
        // forever, retaining the full doc string (same guard as the
        // openPathIntoTab / onFileOpened seed loops). tabsStore is the same
        // singleton `store` wraps; read it directly so this once-created ref
        // never closes over a hook-render value.
        if (!tabsStore.get(id)) return;
        const handle = editorHandles.current.get(id);
        if (handle) handle.setDoc(text);
        else setTimeout(seed, 0);
      };
      seed();
    }
  });

  // Subscribe to MAIN's adopt/release pushes (this window is a transfer target
  // and/or source). MAIN is the sole router; these only mutate the local store.
  useEffect(() => {
    const offAdopt = window.notepads.editor.onAdopt((payload) => {
      // applyAdopt re-keys the adopted tab under a FRESH local editorId (the
      // source's id can collide cross-window — Task #20). Key the diff baseline
      // by the returned local id, not payload.editorId — normalized at set time
      // (lastSavedTextRef invariant: entries are always '\n'-shadow form).
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

  // Transfer test seam (Gate-6 harness, lane-h): drives the genuine begin/
  // complete/void-drop path since Playwright can't synthesize a real HTML5
  // cross-process drag. PA-8-clean (only window.notepads + store).
  useEffect(() => installTransferTestHook(store, transferSource.current), [store]);

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
        setPendingClose({ editorId: id, fileName: tabTitle(tab) });
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
  // tab + its live CM6 view and binds every action to window.notepads (PA-8).
  const statusModel = useStatusBarModel({
    theme: resolvedTheme,
    store,
    getActiveHandle,
    activeEditorId
  });

  // Settings test seam (Phase 5 Gate-5 harness): exposes open/close + the live
  // settings bag + the resolved theme bucket. PA-8-clean (no IPC). Re-installs
  // when the live values change so the getters close over current state.
  useEffect(() => {
    return installSettingsTestHook({
      open: () => setSettingsOpen(true),
      close: () => setSettingsOpen(false),
      getSettings: () => settings,
      getResolvedTheme: () => resolvedTheme
    });
  }, [settings, resolvedTheme]);

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

  // Print + Share (Workstream 6.B/C). Ctrl+P prints the current document and
  // Ctrl+Shift+P prints every open document (one per page); both route through the
  // print host + MAIN webContents.print(). A dispatched 'notepads:share' event
  // hands the active document to MAIN's share/clipboard path. PA-8 (typed bridge).
  // Print actions (Workstream 6.B). Lifted to stable callbacks so the hamburger
  // menu's Print / Print All items and the Ctrl+P / Ctrl+Shift+P accelerators
  // drive the exact same path (print host → MAIN webContents.print()).
  const doPrintCurrent = useCallback((): void => {
    const id = store.activeEditorId;
    const t = id ? store.get(id) : undefined;
    if (id && t) {
      void print.printCurrent(
        {
          title: tabTitle(t),
          text: editorHandles.current.get(id)?.getShadowText() ?? ''
        },
        settings.editorFontFamily
      );
    }
  }, [print, store, settings.editorFontFamily]);
  const doPrintAll = useCallback((): void => {
    void print.printAll(
      store.tabs.map((t) => ({
        title: tabTitle(t),
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
      if (id && t) void share({ title: tabTitle(t), text: readText(id) });
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

  // Each entry reuses the SAME handler the keyboard accelerators already drive:
  // New→store.newTab, Open→doOpen (Ctrl+O), New Window→doNewWindow (Ctrl+Shift+N),
  // Find/Replace→the find bar's openFindBar, Full Screen→F11, CompactOverlay→F12,
  // Print/Print All→the print host (Ctrl+P / Ctrl+Shift+P), Settings→the settings
  // surface, Save/Save As/Save All→doSave/doSaveAll. onOpenRecent feeds the
  // TabStrip Open Recent submenu (it fetches recent.list itself on flyout open).
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
  // not per-document). Bridge the in-editor toggle (Alt+Z + the right-click "Word
  // Wrap" item) to flip the persisted `textWrapping` setting, so the change applies
  // to EVERY open editor and survives restarts — instead of mutating just the
  // focused editor's CM6 compartment (which left other/new tabs unwrapped, forcing
  // a re-toggle in each file). The persisted value flows back to all editors via
  // the `wordWrap` prop below; this only owns the write side.
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
            no seam. Sits BELOW the editor hosts (zIndex 0; the CM6 surface is
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
                    // Above the TabSurfaceWash (zIndex 0) so the editor content paints
                    // over the shared wash (the CM6 surface is transparent, so the wash
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
                    {tab.isLoading ? (
                      // Open in flight (MAIN still reading/decoding): show a
                      // centered spinner INSTEAD of mounting the editor — the tab
                      // appears instantly with its basename while a large file
                      // loads, and no edits can land in a half-loaded buffer. The
                      // editor mounts when openPathIntoTab clears the flag, and
                      // the pending setDoc retry seeds it on the next tick.
                      <div
                        data-testid="editor-loading"
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Spinner size="large" />
                      </div>
                    ) : (
                      <MonacoEditor
                        ref={(h) => {
                          if (h) editorHandles.current.set(tab.editorId, h);
                          else editorHandles.current.delete(tab.editorId);
                        }}
                        onDocChanged={() => {
                          if (!tab.isStreaming) recomputeDirty(tab.editorId);
                          // Re-render the open preview/diff pane to reflect live typing
                          // (replaces the old CM6 updateListener pulse).
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
