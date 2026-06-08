import { FluentProvider } from '@fluentui/react-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keymap, EditorView } from '@codemirror/view';
import type { OpenedFile } from '@shared/ipc-contract';
import { CodeMirrorEditor, type CodeMirrorHandle } from './editor/CodeMirrorEditor';
import { installTestHook, installEditorTestHook, type OpenLabels } from './editor/test-hook';
import { useFindBar } from './editor/search/useFindBar';
import { TabStrip } from './tabs/TabStrip';
import { useTabsStore, tabsStore, setUntitledBaseName } from './tabs/useTabsStore';
import { useTabKeyboard } from './tabs/useTabKeyboard';
import { installTabsTestHook } from './tabs/tabsTestHook';
import { StatusBar } from './statusbar/StatusBar';
import { useStatusBarModel } from './statusbar/useStatusBarModel';
import { recordLastSaved, forgetEditor } from './statusbar/fileStatusTracker';
import { useSettings } from './settings/useSettings';
import { useAppTheme } from './theme/useAppTheme';
import { SettingsSurface } from './settings/SettingsSurface';
import { installSettingsTestHook } from './settings/settingsTestHook';
import { appBackgroundTint } from './theme/tokens';
import { edgeShadowStyle, EDGE_SHADOW_BLUR } from './theme/shadow';
import { tokensForTheme, TabDimensions } from './tabs/tokens';
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
import { useEditorContextMenu } from './editor/EditorContextMenu';
import { useViewModeKeyboard } from './integrations/useViewModeKeyboard';
import { CloseReminderDialog } from './CloseReminderDialog';
import { AppCloseReminderDialog } from './AppCloseReminderDialog';
import { CaptionButtons } from './chrome/CaptionButtons';
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

/**
 * The single continuous wash sheet behind the strip + editor (UWP SetsView:
 * selected-tab brush == content brush). One absolutely-positioned layer mounted
 * inside #app-shell that paints the editor band AND extends UP under the active
 * tab — the two are joined into an inverted-T by `clip-path`, so the selected tab
 * and the editor are ONE painted surface with no strip→editor seam (the boundary
 * is internal to a single paint instead of being the meeting line of two separate
 * translucent washes — the previous "接缝").
 *
 * It extends `TabDimensions.height` px ABOVE #app-shell's top so the notch reaches
 * up over the active tab's body (the strip above is transparent, so the notch
 * shows through under the active tab; the notch is clipped to only the active-tab
 * column, so it can never bleed under the hamburger / scroll / add chrome). When
 * there is no measurable active tab (empty strip, scrolled fully out, or mid-drag)
 * it collapses to a plain full-width band — no stray notch stranded at an old x.
 *
 * Pure presentation: pointer-events:none, aria-hidden, zIndex 0 (below the editor
 * hosts and the transparent strip). HC has no material — headerSelected resolves
 * to the Highlight system color there, which would be wrong as a full content
 * wash, so HC renders nothing (the editor stays flat Canvas like UWP HC).
 */
function TabSurfaceWash(props: {
  rect: { left: number; width: number } | null;
  theme: 'light' | 'dark' | 'hc';
}): JSX.Element | null {
  const { rect, theme } = props;
  // HC: flat forced-colors chrome, no translucent merge wash (matches UWP HC).
  if (theme === 'hc') return null;
  const wash = tokensForTheme(theme).headerSelected;
  // Notch band height = the active tab's body height (the strip's 1px top border
  // is above it). The wash is lifted by this much so its top edge aligns with the
  // tab body's top, and the top `H` px of the layer is the notch region.
  const H = TabDimensions.height;
  // Inverted-T: the active-tab notch (top H px, only under [left, left+width])
  // sitting on the full-width editor band (below H). With no rect, just the band.
  const clipPath = rect
    ? `polygon(` +
      `${rect.left}px 0, ${rect.left + rect.width}px 0, ` + // notch top edge
      `${rect.left + rect.width}px ${H}px, 100% ${H}px, ` + // down + across to right
      `100% 100%, 0 100%, ` + // right→bottom→left
      `0 ${H}px, ${rect.left}px ${H}px)` // up + across back to notch
    : `polygon(0 ${H}px, 100% ${H}px, 100% 100%, 0 100%)`;
  return (
    <div
      data-testid="tab-surface-wash"
      aria-hidden
      style={{
        position: 'absolute',
        top: -H,
        left: 0,
        right: 0,
        bottom: 0,
        background: wash,
        clipPath,
        WebkitClipPath: clipPath,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

export function App(): JSX.Element {
  // Live app theme (Phase 5, Lane C): resolves themeMode + OS theme + accent into
  // a FluentProvider theme and the active 'light'|'dark'|'hc' bucket, recomputed
  // on theme.onOsThemeChanged / theme.onAccentChanged / settings.onChanged with
  // NO reload. Replaces the Phase-2 hardcoded web{Light,Dark}Theme selection.
  const appTheme = useAppTheme();
  const resolvedTheme = appTheme.resolved;

  const isFrameless = useMemo(
    () => navigator.userAgent.includes('Windows') || navigator.userAgent.includes('Mac'),
    [],
  );

  // Live settings bag (MAIN-owned). Shared by the settings surface, the live
  // status-bar visibility (showStatusBar), and the theme resolution above.
  const { settings, update: updateSettings } = useSettings();

  // Settings surface open/close state (entry point in the tab strip toolbar).
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Active tab geometry {left,width} in strip-local px (or null when there is no
  // measurable active tab — empty / scrolled out / mid-drag), reported by TabStrip.
  // Drives the single continuous wash layer below: the wash notches UP under this
  // rect so the selected tab + editor are one painted sheet (no strip→editor seam).
  const [activeTabRect, setActiveTabRect] = useState<{ left: number; width: number } | null>(null);

  const { tabs, activeEditorId, store } = useTabsStore(tabsStore);

  // Live translator — drives the localized untitled new-file base name (below).
  const { t } = useT();

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
  // Stable accessors for the ACTIVE editor's view/handle. These MUST be
  // referentially stable: useStatusBarModel feeds getActiveHandle into a
  // useCallback→useEffect that runs a 250ms caret poll; an inline arrow here
  // would change identity every render, re-run that effect every render, and
  // setLineColumn(new object) → re-render → infinite update loop.
  const getActiveView = useCallback(
    () =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getView() ?? null)
        : null,
    [store],
  );
  const getActiveHandle = useCallback(
    () => (store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null),
    [store],
  );

  const find = useFindBar({ getActiveView });
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

  // Editor right-click context menu (UWP TextEditorContextFlyout). Mounts a CM6
  // contextmenu seam into every editor (via paneEditorExtensions) and renders a
  // positioned Fluent menu. Gives Share + RTL their UI entry points.
  const editorContextMenu = useEditorContextMenu({
    isPreviewEligible: isMarkdownPath(
      (store.activeEditorId ? store.get(store.activeEditorId) : undefined)?.filePath ?? null,
    ),
    onTogglePreview: () => {
      const id = store.activeEditorId;
      const tb = id ? store.get(id) : undefined;
      if (id && tb) store.setViewMode(id, { preview: !tb.viewMode.preview, diff: false });
    },
    onShare: (selectionOnly: boolean) => {
      const id = store.activeEditorId;
      const tb = id ? store.get(id) : undefined;
      const view = getActiveView();
      if (!tb || !view) return;
      const sel = view.state.selection.main;
      const text =
        selectionOnly && !sel.empty
          ? view.state.sliceDoc(sel.from, sel.to)
          : view.state.doc.toString();
      void share({ title: tabTitle(tb), text });
    },
  });

  // Editor extensions including the contextmenu seam (find/preview-pulse + menu).
  const editorExtensionsWithMenu = useMemo(
    () => [paneEditorExtensions, editorContextMenu.extension],
    [paneEditorExtensions, editorContextMenu.extension],
  );

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
      // Seed the diff/dirty baseline TEXT (Phase 6 + Issue 3) BEFORE setDoc: the
      // setDoc dispatch fires the doc-change listener → recomputeDirty, which must
      // read the just-loaded text as the baseline so an open is "clean", not dirty.
      lastSavedTextRef.current.set(id, file.decodedText);
      seedOpened();
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
      () =>
        store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null,
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
    getLastSavedText: (id) => editorHandles.current.get(id)?.getView()?.state.doc.toString() ?? '',
    getPendingText: (id) => editorHandles.current.get(id)?.getView()?.state.doc.toString() ?? '',
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
  useEffect(() => installTransferTestHook(store, transferSource.current), [store]);

  // Open an absolute path into a tab (the shared open primitive). If the path is
  // ALREADY open in this window, focus that tab instead of opening a duplicate
  // (UWP focuses the existing set) — two editors on one path would let the second
  // save silently clobber the first (edit-loss). Otherwise read via MAIN
  // (file.open), seed a fresh tab with the authoritative labels, and seed the
  // diff/dirty baseline BEFORE setDoc so the doc-change listener treats the loaded
  // text as the clean baseline (Issue 3) rather than '' (which would mark it
  // dirty). Used by activation-open, the Open dialog (Ctrl+O), the Open Recent
  // submenu, and drag-drop — every path that opens a file on disk.
  const openPathIntoTab = useCallback(
    (path: string): void => {
      // Focus an existing tab on the same path before opening a duplicate.
      // Windows paths are case-insensitive, so compare case-folded there; the
      // platform is read from navigator.userAgent (PA-8: no node `process`).
      const winNT = navigator.userAgent.includes('Windows');
      const norm = (p: string): string => (winNT ? p.toLowerCase() : p);
      const target = norm(path);
      const existing = store.tabs.find(
        (tab) => tab.filePath !== null && norm(tab.filePath) === target,
      );
      if (existing) {
        store.activate(existing.editorId);
        return;
      }
      void window.notepads.file.open(path).then((res) => {
        if (!res.ok) {
          // Read failed (deleted / locked / permission denied). No renderer
          // notification surface exists yet (doSave/saveAs also surface nothing
          // on error — App.tsx); reporting is tracked separately by the lead.
          return;
        }
        // When the only tab is a pristine untitled seed buffer (created on
        // mount), reuse it for the file instead of opening a new tab. This
        // prevents a leftover empty "Untitled N" tab when the app is launched
        // as a file handler (Open with / double-click in explorer). Re-checked
        // inside .then() so races between multiple simultaneous opens are safe.
        const s = store.tabs;
        const seedTab = s.length === 1 && s[0].filePath === null && !s[0].isModified ? s[0] : null;
        if (seedTab) {
          const id = seedTab.editorId;
          const seedOpened = (): void => {
            const handle = editorHandles.current.get(id);
            if (handle) handle.setDoc(res.data.decodedText);
            else setTimeout(seedOpened, 0);
          };
          lastSavedTextRef.current.set(id, res.data.decodedText);
          seedOpened();
          store.setLabels(id, res.data.encodingId, res.data.eolId);
          store.setFilePath(id, res.data.filePath);
          if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
          return;
        }
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
        const seedOpened = (): void => {
          const handle = editorHandles.current.get(id);
          if (handle) handle.setDoc(res.data.decodedText);
          else setTimeout(seedOpened, 0);
        };
        lastSavedTextRef.current.set(id, res.data.decodedText);
        seedOpened();
        if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
      });
    },
    [store],
  );

  // Open dialog (Ctrl+O + menu, UWP MainMenuButton_OpenButton): MAIN owns the
  // native picker (PA-8); we open each chosen path via the shared primitive. A
  // cancelled picker resolves ok with [] — treated as a no-op.
  const doOpen = useCallback((): void => {
    void window.notepads.file.openDialog().then((res) => {
      if (!res.ok) return;
      for (const path of res.data) openPathIntoTab(path);
    });
  }, [openPathIntoTab]);

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

  // App-window activation (Workstream 6.A): a broker redirect/spawn delivers the
  // file paths to open into THIS window. Open each via the shared primitive.
  useEffect(() => {
    const off = window.notepads.app.onActivation((event) => {
      for (const path of event.paths) openPathIntoTab(path);
    });
    return off;
  }, [openPathIntoTab]);

  // Drag-drop open (UWP NotepadsMainPage Drop): dropping OS files onto the window
  // opens each as a tab. The renderer can't read File.path under the sandbox, so
  // each File is resolved to its absolute path via the preload webUtils helper
  // (window.notepads.paths.forFile — PA-8: webUtils lives in preload, not here).
  // CRITICAL: scope to OS-file drops only (dataTransfer.types includes 'Files')
  // so this never intercepts the dnd-kit intra-strip reorder (pointer-driven, no
  // dataTransfer) or the cross-window tab-transfer token drag (which carries
  // 'application/x-notepads-token', NOT 'Files'). preventDefault on dragover so
  // the browser's default "navigate to file" is suppressed and drop fires.
  useEffect(() => {
    const hasOsFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragOver = (e: DragEvent): void => {
      if (!hasOsFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasOsFiles(e)) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) {
        const path = window.notepads.paths.forFile(file);
        if (path) openPathIntoTab(path);
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openPathIntoTab]);

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
      store.close(id);
      if (store.count() === 0) {
        if (settings.exitWhenLastTabClosed) void window.notepads.window.quit();
        else store.newTab();
      }
    },
    [store, settings.exitWhenLastTabClosed],
  );

  // Close-reminder dialog state (Issue 4, UWP SetCloseSaveReminderDialog). Non-null
  // while a MODIFIED tab is awaiting the user's Save / Don't Save / Cancel choice.
  const [pendingClose, setPendingClose] = useState<{ editorId: string; fileName: string } | null>(
    null,
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
    [store, settings.exitWhenLastTabClosed, performClose],
  );

  // Stable TabStrip callback identities. SortableTab is React.memo'd; if these were
  // fresh inline closures (minted on every App render — App re-renders on EVERY
  // store mutation via useSyncExternalStore), the memo comparator would always see
  // changed handler props and re-render ALL tabs on any setModified/setCaret/etc.
  // Wrapping them in useCallback lets the memo actually skip unrelated tabs.
  const onNewTab = useCallback(() => store.newTab(), [store]);
  const onBeginTransfer = useCallback(
    (id: string) => beginTransfer(store, transferSource.current, id),
    [store],
  );
  const onVoidDrop = useCallback((id: string) => handleVoidDrop(store, id), [store]);

  // Recompute a tab's dirty flag (Issue 3): compare the live '\n'-shadow text to
  // that tab's last-saved baseline (also normalized to '\n' — the stored baseline
  // is raw decoded text that may carry CRLF). Untitled buffers have no baseline
  // entry → '' (any typed character makes them dirty). Drives the tab dot +
  // status-bar "Modified" via store.setModified.
  const recomputeDirty = useCallback(
    (editorId: string): void => {
      const handle = editorHandles.current.get(editorId);
      if (!handle) return;
      const baseline = normalizeToShadow(lastSavedTextRef.current.get(editorId) ?? '');
      const dirty = handle.getShadowText() !== baseline;
      store.setModified(editorId, dirty);
    },
    [store],
  );

  // Save pipeline (Issue 3, UWP NotepadsMainPage.IO.cs:159-217). doSave writes the
  // active (or given) tab: untitled / no filePath / saveAs → native Save-As picker
  // (file.saveAs); else write the existing path (file.save). A plain Ctrl+S on an
  // unmodified, already-on-disk doc is a no-op. On success: re-baseline the shadow
  // text, set filePath + clear isModified (named tab title follows filePath).
  const doSave = useCallback(
    async (editorId: string, opts?: { saveAs?: boolean }): Promise<boolean> => {
      const tab = store.get(editorId);
      const handle = editorHandles.current.get(editorId);
      if (!tab || !handle) return false;
      const saveAs = opts?.saveAs ?? false;
      const shadowText = handle.getShadowText();
      const hasPath = !!tab.filePath;
      // No-op: a clean, already-saved file with a plain Ctrl+S writes nothing.
      if (!saveAs && hasPath && !tab.isModified) return true;

      const res =
        saveAs || !hasPath
          ? await window.notepads.file.saveAs({
              shadowText,
              encodingId: tab.encodingId,
              eolId: tab.eolId,
              suggestedName: tabTitle(tab),
            })
          : await window.notepads.file.save({
              filePath: tab.filePath as string,
              shadowText,
              encodingId: tab.encodingId,
              eolId: tab.eolId,
            });
      // Cancelled picker or write error: leave the tab dirty, surface nothing.
      if (!res.ok) return false;

      // Re-baseline to the JUST-saved shadow text so the doc is clean again, and
      // adopt the authoritative path + labels MAIN echoes back.
      lastSavedTextRef.current.set(editorId, shadowText);
      store.setFilePath(editorId, res.data.filePath);
      store.setLabels(editorId, res.data.encodingId, res.data.eolId);
      recordLastSaved(editorId, res.data.filePath, res.data.dateModifiedMs);
      store.setModified(editorId, false);
      return true;
    },
    [store],
  );

  // Save All (UWP: loop modified editors). Untitled modified buffers each open a
  // Save-As picker in turn. Sequential so the native dialogs don't stack; a
  // cancelled picker (doSave → false) aborts the remaining saves.
  const doSaveAll = useCallback(async (): Promise<void> => {
    for (const t of store.tabs) {
      if (t.isModified && !(await doSave(t.editorId))) break;
    }
  }, [store, doSave]);

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

  // App-level close reminder (UWP MainPage_CloseRequested → AppCloseSaveReminderDialog).
  // MAIN intercepts the native window close (X / Alt+F4 / OS) and pushes
  // onCloseRequested; we run the unsaved-changes flow, then call window.confirmClose()
  // to let the real close proceed. `appClosePending` shows the dialog while the user
  // decides. NOTE: UWP skips this prompt when session-snapshot is ON (it persists the
  // session instead). Renderer session persistence is not yet wired, so we ALWAYS
  // prompt on dirty tabs — prompting can never lose data; silently closing could.
  const [appClosePending, setAppClosePending] = useState(false);

  useEffect(() => {
    return window.notepads.window.onCloseRequested(() => {
      const anyDirty = store.tabs.some((t) => t.isModified);
      if (!anyDirty) {
        void window.notepads.window.confirmClose();
        return;
      }
      setAppClosePending(true);
    });
  }, [store]);

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
    onCloseActive: (id) => closeTab(id),
  });

  // Status-bar view model (Lane C): derives the 8-column props from the active
  // tab + its live CM6 view and binds every action to window.notepads (PA-8).
  const statusModel = useStatusBarModel({
    theme: resolvedTheme,
    store,
    getActiveHandle,
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
  // refs track the resolved state so each toggle flips it. The toggles are
  // lifted to stable callbacks so the main-menu flyout (hamburger) drives the
  // same code path as the F11/F12 accelerators.
  const fullScreenRef = useRef(false);
  const compactRef = useRef(false);
  const toggleFullScreen = useCallback((): void => {
    void window.notepads.window.setFullScreen(!fullScreenRef.current).then((res) => {
      if (res.ok) fullScreenRef.current = res.data.isFullScreen;
    });
  }, []);
  const toggleCompact = useCallback((): void => {
    void window.notepads.window.setCompactOverlay(!compactRef.current).then((res) => {
      if (res.ok) compactRef.current = res.data.isCompactOverlay;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullScreen();
      } else if (e.key === 'F12' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        // F12 → toggle the compact-overlay window (frameless always-on-top, the
        // 0.A sign-off #8 substitute). Bare F12 only, so a modified chord never
        // triggers it; MAIN owns the actual window state machine (window.ts).
        e.preventDefault();
        toggleCompact();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('notepads:toggle-compact', toggleCompact);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('notepads:toggle-compact', toggleCompact);
    };
  }, [toggleFullScreen, toggleCompact]);

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
      void print.printCurrent({
        title: tabTitle(t),
        text: editorHandles.current.get(id)?.getShadowText() ?? '',
      });
    }
  }, [print, store]);
  const doPrintAll = useCallback((): void => {
    void print.printAll(
      store.tabs.map((t) => ({
        title: tabTitle(t),
        text: editorHandles.current.get(t.editorId)?.getShadowText() ?? '',
      })),
    );
  }, [print, store]);
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
      onFullScreen: toggleFullScreen,
      onCompactOverlay: toggleCompact,
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
      onNewWindow: doNewWindow,
      // Open Recent submenu (TabStrip fetches the list on flyout open via
      // recent.list and opens each entry via this shared primitive).
      onOpenRecent: openPathIntoTab,
    }),
    [
      store,
      find.keymapCallbacks,
      toggleFullScreen,
      toggleCompact,
      doPrintCurrent,
      doPrintAll,
      doSave,
      doSaveAll,
      doOpen,
      doNewWindow,
      openPathIntoTab,
    ],
  );

  // Map the MAIN-owned persisted Settings bag onto the editor-behavior facets
  // CodeMirrorEditor consumes (Worker C wires consumption). Only the four fields
  // EditorSettings exposes are forwarded; the rest of Settings is theme/IO state.
  const editorBehaviorSettings = useMemo(
    () => ({
      tabAsSpaces: settings.tabIndents,
      smartCopy: settings.smartCopy,
      searchEngine: settings.searchEngine,
      fontSize: settings.editorFontSize,
    }),
    [settings.tabIndents, settings.smartCopy, settings.searchEngine, settings.editorFontSize],
  );
  // word-wrap derives from the persisted TextWrapMode ('wrap' | 'noWrap').
  const editorWordWrap = settings.textWrapping === 'wrap';

  return (
    <FluentProvider
      theme={appTheme.theme}
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: appBackgroundTint(resolvedTheme, settings.tintOpacity),
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
        captionSlot={isFrameless ? <CaptionButtons theme={resolvedTheme} /> : undefined}
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
          background: 'transparent',
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
                zIndex: 1,
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
                  display: tab.viewMode.diff ? 'none' : 'block',
                }}
              >
                <CodeMirrorEditor
                  ref={(h) => {
                    if (h) editorHandles.current.set(tab.editorId, h);
                    else editorHandles.current.delete(tab.editorId);
                  }}
                  editorExtensions={editorExtensionsWithMenu}
                  onDocChanged={() => recomputeDirty(tab.editorId)}
                  settings={editorBehaviorSettings}
                  lineNumbers={settings.displayLineNumbers}
                  lineHighlighter={settings.displayLineHighlighter}
                  wordWrap={editorWordWrap}
                  direction="ltr"
                  fontFamily={settings.editorFontFamily}
                  fontSize={settings.editorFontSize}
                  fontStyle={settings.editorFontStyle}
                  fontWeight={settings.editorFontWeight}
                  accentColor={appTheme.accentHex}
                  themeMode={appTheme.resolved}
                />
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
                    borderLeft: '1px solid rgba(128,128,128,0.4)',
                  }}
                >
                  <MarkdownPreview
                    text={shadow}
                    isDark={resolvedTheme === 'dark'}
                    fontSize={settings.editorFontSize}
                    editorView={editorHandles.current.get(tab.editorId)?.getView() ?? null}
                  />
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
                    left: 0,
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
        {/* Find/replace bar — floats top-right OVER the editor region (UWP
            placeholder placement). Mounted INSIDE #app-shell (position:relative)
            so its absolute top-right offsets anchor to the editor region, and it
            overlays content instead of docking at the window bottom. */}
        {find.findBar}
      </div>
      {settings.showStatusBar ? <StatusBar {...statusModel} /> : null}
      <SettingsSurface
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        update={updateSettings}
        theme={appTheme.theme}
        resolvedTheme={resolvedTheme}
      />
      <CloseReminderDialog
        pending={pendingClose}
        onSave={onReminderSave}
        onDontSave={onReminderDontSave}
        onCancel={onReminderCancel}
      />
      <AppCloseReminderDialog
        open={appClosePending}
        onSaveAllAndExit={onAppCloseSaveAll}
        onDiscardAndExit={onAppCloseDiscard}
        onCancel={onAppCloseCancel}
      />
      {editorContextMenu.menu}
    </FluentProvider>
  );
}
