import { FluentProvider, Spinner } from '@fluentui/react-components';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { keymap, EditorView } from '@codemirror/view';
import type { OpenedFile } from '@shared/ipc-contract';
import { isMac } from '@shared/platform';
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
import { installSettingsTestHook } from './settings/settingsTestHook';
import { appRootBackground, isWallpaperActive, wallpaperLayerStyle } from './theme/wallpaper';
import { useWallpaper } from './theme/useWallpaper';
import { edgeShadowStyle, EDGE_SHADOW_BLUR } from './theme/shadow';
import { tokensForTheme, TabDimensions, TabAnimation } from './tabs/tokens';
import {
  applyAdopt,
  applyRelease,
  beginTransfer,
  handleVoidDrop,
  installTransferTestHook,
  type TransferTextSource
} from './tabs/transferWiring';
import type { TabState } from './tabs/types';
import { normalizeToShadow } from './editor/eol';
import { wordWrapToggleRef } from './editor/commands/wordWrap';
import { usePrint } from './integrations/usePrint';
import { useShare } from './integrations/useShare';
import { useEditorContextMenu } from './editor/EditorContextMenu';
import { useViewModeKeyboard } from './integrations/useViewModeKeyboard';
import { CloseReminderDialog } from './CloseReminderDialog';
import { AppCloseReminderDialog } from './AppCloseReminderDialog';
import { CaptionButtons } from './chrome/CaptionButtons';
import { useT } from './i18n';
import { usePrefersReducedMotion } from './theme/usePrefersReducedMotion';

/**
 * Heavy secondary panes loaded LAZILY (cold-start win, visually transparent):
 * none are visible at first paint — they mount only on a user action (Alt+P /
 * Alt+D / Ctrl+,). Splitting them out pulls markdown-it + its @mdit plugins +
 * highlight.js + dompurify (MarkdownPreview), the diff package (DiffViewer), and
 * the four settings panes (SettingsSurface) out of the first-paint chunk. Each is
 * a NAMED export, so React.lazy gets a synthesized default. Their mount sites are
 * wrapped in <Suspense fallback={null}> — a one-frame async on a user-triggered
 * mount is imperceptible, so there is zero visible change.
 */
const MarkdownPreview = lazy(() =>
  import('./markdown/MarkdownPreview').then((m) => ({ default: m.MarkdownPreview }))
);
const DiffViewer = lazy(() => import('./diff/DiffViewer').then((m) => ({ default: m.DiffViewer })));
const SettingsSurface = lazy(() =>
  import('./settings/SettingsSurface').then((m) => ({ default: m.SettingsSurface }))
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
        zIndex: 0
      }}
    />
  );
}

/**
 * C5 — secondary-pane mount transition. Wraps the preview/diff pane content so it
 * fades in (opacity 0→1) and slides a few px from the right (translateX, a
 * compositor-only transform) when it MOUNTS, matching the existing ~160ms motion
 * tokens (TabAnimation.enterMs / brushFadeMs). Only the appearing secondary pane
 * animates — never the editor pane itself. Fully gated by `reduced`: when the user
 * prefers reduced motion the children render at their final state with no
 * transition, so motion-sensitive users see the same instant pane the app always
 * showed. The one-tick state flip (entered) starts from the pre-animation state on
 * the first commit and transitions to the resting state on the next frame.
 */
function PaneMount(props: { reduced: boolean; children: ReactNode }): JSX.Element {
  const { reduced, children } = props;
  const [entered, setEntered] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setEntered(true);
      return;
    }
    // rAF (not setTimeout): we only need the style to transition AFTER the initial
    // opacity:0 paint commits; a single frame is enough and never starves here
    // because a freshly-mounted, user-triggered pane is on a compositing window.
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  // Reduced motion: render children directly, no wrapper transform/transition.
  if (reduced) return <>{children}</>;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateX(0)' : 'translateX(8px)',
        transition: `opacity ${TabAnimation.enterMs}ms ease-out, transform ${TabAnimation.enterMs}ms ease-out`,
        willChange: entered ? 'auto' : 'opacity, transform'
      }}
    >
      {children}
    </div>
  );
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

  // One CM6 handle per editorId. The active editor's handle backs the test hook.
  const editorHandles = useRef<Map<string, CodeMirrorHandle | null>>(new Map());
  // Opaque labels for the ACTIVE editor (carried back to MAIN on save).
  const labelsRef = useRef<OpenLabels>({ encodingId: null, eolId: null });

  // Last-saved baseline TEXT per editor (Phase 6, diff viewer). The store/tracker
  // keep only mtime, so the diff pane's "original" column needs the text captured
  // at each authoritative load point (open / activation-open / adopt). Untitled
  // buffers have no entry → '' (everything shows as an insert). Pure renderer.
  // INVARIANT: entries are stored ALREADY '\n'-shadow-normalized (every writer
  // normalizes at set time). recomputeDirty runs on EVERY doc change; normalizing
  // a raw CRLF baseline there instead would re-build a full copy of the string
  // per keystroke (~190ms + ~120MB transient on a 120MB file — measured).
  const lastSavedTextRef = useRef<Map<string, string>>(new Map());
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
    [store]
  );
  const getActiveHandle = useCallback(
    () => (store.activeEditorId ? (editorHandles.current.get(store.activeEditorId) ?? null) : null),
    [store]
  );

  const find = useFindBar({ getActiveView });
  // Compose the find seam once: the find keymap (Ctrl+F/H/G, F3/Shift+F3, Esc)
  // plus the match-highlight StateField, mounted via CodeMirrorEditor's
  // `editorExtensions` prop (after the command keymap, before the CM6 base).
  const findEditorExtensions = useMemo(
    () => [keymap.of(find.keymap), find.editorExtensions],
    [find.keymap, find.editorExtensions]
  );

  // Compose the editor extensions actually mounted: the find seam PLUS a doc-change
  // pulse that re-renders App while a content pane is open, so MarkdownPreview /
  // DiffViewer reflect live typing. The listener is a no-op when no pane is open.
  // The pulse is TRAILING-DEBOUNCED ~150ms (B1): every doc change reschedules the
  // single pending timer, so a run of keystrokes fires at most one bump ~150ms
  // after typing settles. The final rendered output is identical to the per-
  // keystroke version (it always re-reads the live shadow text) — only the cadence
  // changes, which is what removes the per-keystroke markdown + diff recompute.
  const paneEditorExtensions = useMemo(
    () => [
      ...findEditorExtensions,
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const id = tabsStore.activeEditorId;
        const vm = id ? tabsStore.get(id)?.viewMode : undefined;
        // Preserve the existing gating: only pulse while a preview/diff pane is open.
        if (!vm || !(vm.preview || vm.diff)) return;
        if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = setTimeout(() => {
          pulseTimerRef.current = null;
          bumpDocVersion((v) => v + 1);
        }, 150);
      })
    ],
    [findEditorExtensions]
  );

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

  // Editor right-click context menu (UWP TextEditorContextFlyout). Mounts a CM6
  // contextmenu seam into every editor (via paneEditorExtensions) and renders a
  // positioned Fluent menu. Gives Share + RTL their UI entry points.
  const editorContextMenu = useEditorContextMenu({
    // Preview offered for every file type (see useViewModeKeyboard above).
    isPreviewEligible: store.activeEditorId != null,
    onTogglePreview: () => {
      const id = store.activeEditorId;
      const tb = id ? store.get(id) : undefined;
      if (!id || !tb) return;
      store.setViewMode(id, { preview: !tb.viewMode.preview, diff: false });
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
    }
  });

  // Editor extensions including the contextmenu seam (find/preview-pulse + menu).
  const editorExtensionsWithMenu = useMemo(
    () => [paneEditorExtensions, editorContextMenu.extension],
    [paneEditorExtensions, editorContextMenu.extension]
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
      // Normalize ONCE here and feed the same string to the baseline AND setDoc
      // (on already-'\n' input setDoc's internal normalize has no matches and —
      // in V8, which returns the receiver from a no-match String.replace — builds
      // no second full-size copy; that's an engine behavior, not ECMAScript spec,
      // but Electron pins V8. Matters on >100MB files).
      const normalized = normalizeToShadow(file.decodedText);
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
      seedOpened();
      store.setLabels(id, file.encodingId, file.eolId);
      store.setFilePath(id, file.filePath);
      labelsRef.current = { encodingId: file.encodingId, eolId: file.eolId };
      // Seed the external-modification baseline (column 0) from the authoritative
      // OpenedFile mtime so a later disk change is detectable (Lane C, Gate-4).
      if (file.filePath) recordLastSaved(id, file.filePath, file.dateModifiedMs);
    },
    [store]
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
  // CM6 view to the keyboard-conformance + undo-granularity e2e. PA-8-clean — it
  // reads the EditorView + public CM6 history helpers, no IPC/fs. Installed after
  // installTestHook so it attaches to the same window.__notepadsTest object.
  useEffect(() => {
    const uninstall = installEditorTestHook(() =>
      store.activeEditorId
        ? (editorHandles.current.get(store.activeEditorId)?.getView() ?? null)
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
    getPendingText: (id) => editorHandles.current.get(id)?.getView()?.state.doc.toString() ?? '',
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
      lastSavedTextRef.current.set(localId, normalizeToShadow(payload.file.decodedText));
    });
    const offRelease = window.notepads.editor.onRelease(({ editorId }) =>
      applyRelease(store, editorId)
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
        (tab) => tab.filePath !== null && norm(tab.filePath) === target
      );
      if (existing) {
        store.activate(existing.editorId);
        return;
      }
      // Create/flag the target tab BEFORE the IPC read so the UI reacts
      // IMMEDIATELY (tab title = basename, spinner in the editor area) instead
      // of sitting on the previous/new-file UI while MAIN reads + decodes a
      // large file. The placeholder carries the path, so the duplicate check
      // above also dedupes a second open of the same file mid-read.
      //
      // When the only tab is a pristine untitled seed buffer (created on
      // mount), reuse it for the file instead of opening a new tab. This
      // prevents a leftover empty "Untitled N" tab when the app is launched
      // as a file handler (Open with / double-click in explorer). The claim is
      // synchronous with placeholder creation, so simultaneous opens
      // (multi-select Ctrl+O / multi-path activation) claim the seed at most
      // once — the second open sees filePath/isLoading set and makes a new tab.
      const s = store.tabs;
      const seedTab =
        s.length === 1 && s[0].filePath === null && !s[0].isModified && !s[0].isLoading
          ? s[0]
          : null;
      let id: string;
      if (seedTab) {
        id = seedTab.editorId;
        store.setFilePath(id, path);
        store.setLoading(id, true);
        store.activate(id);
      } else {
        id = store.newTab({ filePath: path, isLoading: true, activate: true });
      }
      void window.notepads.file.open(path).then((res) => {
        // The placeholder may have been closed while the read was in flight —
        // bail so nothing below resurrects state for a dead tab (and the seed
        // retry loop can never spin forever keeping the huge string alive).
        if (!store.get(id)) return;
        if (!res.ok) {
          // Read failed (deleted / locked / permission denied). No renderer
          // notification surface exists yet (doSave/saveAs also surface nothing
          // on error — App.tsx); reporting is tracked separately by the lead.
          // Roll the placeholder back: a reused seed reverts to its pristine
          // untitled self; a fresh placeholder closes (re-seeding an untitled
          // buffer if it was the last tab, mirroring performClose).
          if (seedTab) {
            store.setFilePath(id, null);
            store.setLoading(id, false);
          } else {
            store.close(id);
            if (store.count() === 0) store.newTab();
          }
          return;
        }
        // Normalize ONCE; share the string between baseline and setDoc (whose
        // internal normalize then matches nothing — V8 returns the receiver
        // from a no-match String.replace, an engine behavior Electron pins,
        // so no duplicate full-size copy is built).
        const normalized = normalizeToShadow(res.data.decodedText);
        // The editor mounts only after isLoading clears below (the host shows
        // a spinner while loading), so seed once its handle exists. Call
        // synchronously first, then setTimeout(0)-retry while the handle is
        // null — NOT rAF, which never fires in a non-compositing window (the
        // Playwright primary window, or a minimized/occluded one) and would
        // leave the doc empty. setDoc tolerates an unmounted view. The retry
        // aborts if the tab is closed meanwhile (releases the retained string).
        const seedOpened = (): void => {
          if (!store.get(id)) return;
          const handle = editorHandles.current.get(id);
          if (handle) handle.setDoc(normalized);
          else setTimeout(seedOpened, 0);
        };
        lastSavedTextRef.current.set(id, normalized);
        store.setLabels(id, res.data.encodingId, res.data.eolId);
        store.setFilePath(id, res.data.filePath);
        if (res.data.filePath) recordLastSaved(id, res.data.filePath, res.data.dateModifiedMs);
        // Clear the flag BEFORE seeding: this mounts the editor whose handle
        // the seed retry waits for.
        store.setLoading(id, false);
        seedOpened();
      });
    },
    [store]
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
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          for (const path of event.payload.paths) {
            openPathIntoTab(path);
          }
        }
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
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
    [store, settings.exitWhenLastTabClosed]
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
        forgetEditor(id);
      }
    }
  }, [tabs]);

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

  // Recompute a tab's dirty flag (Issue 3): compare the live '\n'-shadow text to
  // that tab's last-saved baseline. The baseline map stores entries ALREADY
  // shadow-normalized (see lastSavedTextRef), so no normalize pass runs here —
  // this fires on EVERY doc change, and re-normalizing a 120MB baseline per
  // keystroke costs ~190ms + a full-size transient copy (measured). Untitled
  // buffers have no baseline entry → '' (any typed character makes them dirty).
  // Drives the tab dot + status-bar "Modified" via store.setModified.
  const recomputeDirty = useCallback(
    (editorId: string): void => {
      const handle = editorHandles.current.get(editorId);
      if (!handle) return;
      const baseline = lastSavedTextRef.current.get(editorId) ?? '';
      // Length fast-path: getShadowText() materializes the WHOLE document as a
      // fresh string (doc.toString() — ~46ms + a full-size allocation per call on
      // a 120MB doc, measured), and this runs on EVERY doc change. Most edits
      // change the length, so compare doc.length (the CM6 rope tracks it in O(1);
      // the line separator is pinned to '\n', matching the baseline's shadow
      // form) and only materialize + compare content when the lengths tie.
      const view = handle.getView();
      if (view && view.state.doc.length !== baseline.length) {
        store.setModified(editorId, true);
        return;
      }
      const dirty = handle.getShadowText() !== baseline;
      store.setModified(editorId, dirty);
    },
    [store]
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
              // Save As on a file-backed tab starts in the file's CURRENT folder
              // (UWP FileSavePicker seeded SuggestedSaveFile). PA-8: no path
              // module in the renderer — slice the directory off the absolute
              // path INCLUSIVE of the last separator (so a drive-root file
              // yields "C:\", which path.join treats as absolute, not the
              // drive-relative "C:"); MAIN joins the name back on. Untitled
              // buffers pass undefined and MAIN anchors to Documents.
              defaultDir: ((): string | undefined => {
                if (!tab.filePath) return undefined;
                const sep = tab.filePath.search(/[\\/][^\\/]*$/);
                return sep >= 0 ? tab.filePath.slice(0, sep + 1) : undefined;
              })()
            })
          : await window.notepads.file.save({
              filePath: tab.filePath as string,
              shadowText,
              encodingId: tab.encodingId,
              eolId: tab.eolId
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
    [store]
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
        text: editorHandles.current.get(id)?.getShadowText() ?? ''
      });
    }
  }, [print, store]);
  const doPrintAll = useCallback((): void => {
    void print.printAll(
      store.tabs.map((t) => ({
        title: tabTitle(t),
        text: editorHandles.current.get(t.editorId)?.getShadowText() ?? ''
      }))
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
      onOpenRecent: openPathIntoTab
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
      openPathIntoTab
    ]
  );

  // Map the MAIN-owned persisted Settings bag onto the editor-behavior facets
  // CodeMirrorEditor consumes (Worker C wires consumption). Only the four fields
  // EditorSettings exposes are forwarded; the rest of Settings is theme/IO state.
  const editorBehaviorSettings = useMemo(
    () => ({
      tabAsSpaces: settings.tabIndents,
      smartCopy: settings.smartCopy,
      searchEngine: settings.searchEngine,
      fontSize: settings.editorFontSize
    }),
    [settings.tabIndents, settings.smartCopy, settings.searchEngine, settings.editorFontSize]
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
                  <CodeMirrorEditor
                    ref={(h) => {
                      if (h) editorHandles.current.set(tab.editorId, h);
                      else editorHandles.current.delete(tab.editorId);
                    }}
                    editorExtensions={editorExtensionsWithMenu}
                    onDocChanged={() => recomputeDirty(tab.editorId)}
                    filePath={tab.filePath}
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
                        editorView={editorHandles.current.get(tab.editorId)?.getView() ?? null}
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
      {settings.showStatusBar ? <StatusBar {...statusModel} /> : null}
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
      {editorContextMenu.menu}
    </FluentProvider>
  );
}
