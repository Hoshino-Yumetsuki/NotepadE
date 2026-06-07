import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@fluentui/react-components';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState } from './types';
import type { TabsStore } from './useTabsStore';
import type { RecentEntry } from '@shared/ipc-contract';
import { TabContextMenu } from './TabContextMenu';
import {
  TabGlyph,
  TabDimensions,
  TabScroll,
  TabAnimation,
  SEGOE_MDL2_FONT_FAMILY,
  tokensForTheme,
  type TabTheme,
  type TabThemeTokens,
} from './tokens';
import { useReveal, revealGradient, tokensForReveal, REVEAL_VAR_OPACITY } from '../theme/reveal';
import { clampOverlayToList, scrollLeftToReveal } from './tabScroll';
import { useT } from '../i18n';

/**
 * ============================================================================
 *  TabStrip — from-scratch SetsView (Phase 2, stream C)
 * ============================================================================
 *
 * 1:1 port of UWP Notepads.Controls/SetsView. Renders the horizontal tab strip
 * with dnd-kit reorder, hover/selected close buttons (glyph E711), an add-tab
 * button (E710), scroll-overflow chevrons (E76B/E76C, ScrollAmount=50), and
 * middle-click close. Right-click opens the TabContextMenu. F2 / double-click
 * the title begins inline rename.
 *
 * Visuals are hardcoded theme tokens (Dark #2E2E2E / Light #F0F0F0 per HARD
 * RULES); tab fills are translucent overlays matching SetsView ThemeDictionaries.
 * Equal-width algorithm: clamp(stripWidth / tabCount, 90, 210) — fractional, not
 * pixel-rounded (UWP UseLayoutRounding=False).
 *
 * PA-8: renderer-only. File-system actions route through window.notepads.shell.
 */

export interface TabStripProps {
  /** Live tab list (from useTabsStore snapshot). */
  tabs: readonly TabState[];
  /** Currently active editorId, or null when empty. */
  activeEditorId: string | null;
  /** The store the strip drives. */
  store: TabsStore;
  /** Dark vs light theme — selects the hardcoded token set. */
  isDark: boolean;
  /**
   * Explicit strip theme override ('light' | 'dark' | 'hc'). When set it wins
   * over `isDark` — used by the harness to capture the Phase-2 strip-local
   * high-contrast golden without touching the global FluentProvider.
   */
  theme?: TabTheme;
  /** Add-tab (+) handler. */
  onNewTab(): void;
  /**
   * Main-menu (hamburger) command bag (Phase 8, UI-fidelity). Renders the app
   * MenuFlyout to the LEFT of the tab strip (1:1 UWP MainMenuButton). Each entry
   * is wired by the App to the EXISTING command/handler where one exists; entries
   * with no underlying command yet are rendered disabled (greyed) to keep the
   * structure UWP-identical. Optional so the Phase-2 tab tests (no menu) are
   * unaffected.
   */
  menu?: MainMenuCommands;
  /**
   * Close handler (override to add a dirty-save prompt later). Defaults to
   * store.close.
   */
  onCloseTab?(editorId: string): void;
  /**
   * Cross-window transfer (Workstream 6.A). When provided, each tab becomes a
   * native drag source: `onBeginTransfer` mints the MAIN transfer token (the
   * HTML5 drag carries ONLY that token), and `onVoidDrop` applies the UWP
   * SetDraggedOutside rule when a drag ends outside any window. Optional so the
   * Phase-2 tab tests (no transfer) are unaffected.
   */
  onBeginTransfer?(editorId: string): Promise<string | null>;
  onVoidDrop?(editorId: string): void;
  /**
   * Custom window caption controls (min/max/close), rendered FLUSH at the strip's
   * top-right corner — the strip is the top chrome row and owns the window's right
   * edge. Optional so the Phase-2 tab tests (no caption) are unaffected. The slot
   * sits after the add-tab button; on Windows it replaces the (removed) OS
   * titleBarOverlay so the buttons paint transparent over the acrylic.
   */
  captionSlot?: React.ReactNode;
  /**
   * Reports the active tab's box {left,width} in STRIP-LOCAL px (clamped to the
   * visible tab-list viewport), or null when there is no measurable active tab —
   * empty strip, the active tab scrolled fully out of view, or mid-drag. The App
   * consumes this to drive the SINGLE continuous wash layer behind the strip +
   * editor: the wash extends up under exactly this rect (an inverted-T notch) so
   * the selected tab and the editor read as one connected sheet with NO seam at
   * the strip→editor boundary (the boundary is internal to one painted layer
   * instead of being the meeting line of two separate translucent washes). The
   * same measured rect still feeds the in-strip TabElevation side-shadow frame.
   * Optional so the Phase-2 tab tests (no wash host) are unaffected.
   */
  onActiveTabGeometry?(rect: { left: number; width: number } | null): void;
}

/** The label a tab shows: basename of filePath, else its untitled name. */
function tabTitle(tab: TabState): string {
  if (tab.filePath === null) return tab.untitledName || 'Untitled';
  // Renderer has no Node basename helper (PA-8); split on both separators here.
  const parts = tab.filePath.split(/[\\/]/);
  return parts[parts.length - 1] || tab.filePath;
}

/**
 * App main-menu command bag (the hamburger MenuFlyout). Every entry maps to an
 * EXISTING App command where one exists; an `undefined` callback renders that
 * item disabled so the menu structure stays 1:1 with the UWP MainMenuButton flyout
 * (New Window / Save All / Open Recent / Print / Print All have no renderer
 * command yet — they come through as `undefined` → disabled). PA-8: pure callbacks.
 */
export interface MainMenuCommands {
  onNew(): void;
  /** TODO: multi-window (Ctrl+Shift+N) — no renderer command yet → disabled. */
  onNewWindow?: () => void;
  /** TODO: file-open dialog (Ctrl+O) — no renderer picker yet → disabled. */
  onOpen?: () => void;
  /**
   * Open Recent (UWP MenuOpenRecentlyUsedFileButton submenu). When provided, the
   * MainMenu renders an "Open Recent" submenu populated from `recent.list()`
   * (fetched when the flyout opens); selecting an entry opens its path. The list
   * itself is fetched by the MainMenu via window.notepads.recent — this callback
   * just opens one chosen absolute path (the App's shared open primitive).
   */
  onOpenRecent?: (path: string) => void;
  /** TODO: save active tab (Ctrl+S) — no renderer save handler yet → disabled. */
  onSave?: () => void;
  /** TODO: save-as (Ctrl+Shift+S) — no renderer save-as handler yet → disabled. */
  onSaveAs?: () => void;
  /** TODO: save all — no renderer command yet → disabled. */
  onSaveAll?: () => void;
  onFind(): void;
  onReplace(): void;
  onFullScreen(): void;
  onCompactOverlay(): void;
  /** Print the active document (Ctrl+P) — wired to the print host. */
  onPrint?: () => void;
  /** Print every open document (Ctrl+Shift+P) — wired to the print host. */
  onPrintAll?: () => void;
  onSettings(): void;
}

interface SortableTabProps {
  tab: TabState;
  index: number;
  active: boolean;
  tokens: TabThemeTokens;
  /** Resolved strip theme — selects the cursor-follow reveal tint (Phase 7). */
  revealTheme: TabTheme;
  width: number;
  tabCount: number;
  renaming: boolean;
  onActivate(editorId: string): void;
  onClose(editorId: string): void;
  onContextActions: (tab: TabState) => {
    onClose(): void;
    onCloseOthers(): void;
    onCloseToRight(): void;
    onCloseSaved(): void;
    onCopyFullPath(): void;
    onOpenContainingFolder(): void;
    onRename(): void;
  };
  onBeginRename(editorId: string): void;
  onCommitRename(editorId: string, value: string): void;
  onCancelRename(): void;
  /** True when this tab was just inserted, so it should play the entrance animation. */
  animateEnter?: boolean;
  /** Cross-window transfer hooks (optional; see TabStripProps). */
  onBeginTransfer?(editorId: string): Promise<string | null>;
  onVoidDrop?(editorId: string): void;
}

function SortableTabImpl(props: SortableTabProps): JSX.Element {
  const {
    tab,
    index,
    active,
    tokens,
    revealTheme,
    width,
    tabCount,
    renaming,
    onActivate,
    onClose,
    onContextActions,
    onBeginRename,
    onCommitRename,
    onCancelRename,
    animateEnter,
    onBeginTransfer,
    onVoidDrop,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.editorId,
  });
  const [hovered, setHovered] = useState(false);
  const renameRef = useRef<HTMLInputElement | null>(null);
  // Cursor-follow reveal highlight (Phase 7, Task #27): writes --reveal-x/y/opacity
  // on the tab header so the radial layer below tracks the pointer. Disabled in HC
  // (tokensForReveal('hc') is transparent), matching the UWP no-reveal HC material.
  const reveal = useReveal();
  const revealTokens = tokensForReveal(revealTheme);
  // The radial-gradient string depends only on the theme tokens (a stable
  // module-level singleton per theme), so build it once per theme instead of
  // re-concatenating it on every render — during a dnd-kit drag this component
  // re-renders per pointer tick, and an inline rebuild would re-create the
  // gradient (and invite a re-raster) each tick.
  const revealBackground = useMemo(() => revealGradient(revealTokens), [revealTokens]);
  const { t } = useT();

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  // Close button visible on hover OR selected (UWP CommonStates).
  const showClose = hovered || active;
  // The SELECTED tab is transparent: its surface is painted by the single
  // continuous wash layer behind the strip + editor (App #app-shell), which
  // extends up under this tab as an inverted-T notch so the tab and the editor
  // read as one sheet with no seam. Painting headerSelected here too would stack a
  // SECOND translucent layer over the wash (alpha doubling → a darker block) and
  // re-introduce a boundary. Hover still gets its own translucent fill (it sits
  // over the wash only while pointer-over, an intentional lift). Unselected = bare.
  const fill = active ? 'transparent' : hovered ? tokens.headerHover : 'transparent';
  const textColor = active ? tokens.textSelected : tokens.textDefault;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // dnd-kit owns `transition` mid-drag (transform easing). At rest we compose
    // the reorder transform-settle with the UWP `<BrushTransition/>` background
    // fade (+ foreground), so selecting/hovering a tab cross-fades its fill
    // instead of snapping — the missing animation the user flagged ("生硬").
    transition:
      transition ??
      `transform ${TabAnimation.reorderMs}ms, background-color ${TabAnimation.brushFadeMs}ms ease, color ${TabAnimation.brushFadeMs}ms ease`,
    width,
    minWidth: TabDimensions.minWidth,
    maxWidth: TabDimensions.maxWidth,
    height: TabDimensions.height,
    paddingLeft: TabDimensions.paddingLeft,
    paddingRight: TabDimensions.paddingRight,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    flex: '0 0 auto',
    background: fill,
    // NOTE: the selected-tab elevation (left/right side shadows + the strip→editor
    // merge) is NOT drawn here — a box-shadow on this element is clipped by the tab
    // list's overflow (scroller) and the strip's overflow, so it never reaches the
    // neighbors, the menu/add buttons, or the editor below. It is rendered instead
    // by the unclipped TabElevation overlay (see TabStrip), positioned over this
    // tab's measured rect. We only lift the active tab above its siblings here.
    zIndex: active ? 1 : undefined,
    color: textColor,
    cursor: 'default',
    userSelect: 'none',
    opacity: isDragging ? 0.6 : 1,
    // UWP SetsViewItem header is ControlContentThemeFontSize (= 14px) in
    // ContentControlThemeFontFamily (Segoe UI), per SetsView.xaml:769-770.
    fontSize: 14,
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };

  // Middle-click closes; suppress Ctrl+click selection toggle (UWP SetsViewItem).
  // Composes with dnd-kit's pointer listener so drag activation still works.
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(tab.editorId);
      return;
    }
    if (e.button === 0) {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click is suppressed in UWP (no selection toggle, no activate).
        e.preventDefault();
        return;
      }
      onActivate(tab.editorId);
      // Hand off to dnd-kit so a drag can begin past the activation distance.
      listeners?.onPointerDown?.(e);
    }
  };

  const actions = onContextActions(tab);

  // Native HTML5 drag = the cross-window transfer channel (separate from
  // dnd-kit's pointer-driven intra-strip reorder). On dragstart we mint the
  // MAIN token and carry ONLY it; on a void drop (dropEffect 'none') we apply
  // the UWP SetDraggedOutside rule. No-op unless transfer hooks are provided.
  const transferEnabled = onBeginTransfer != null;
  const onNativeDragStart = (e: React.DragEvent): void => {
    if (!onBeginTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    void onBeginTransfer(tab.editorId).then((token) => {
      if (token) e.dataTransfer.setData('application/x-notepads-token', token);
    });
  };
  const onNativeDragEnd = (e: React.DragEvent): void => {
    if (e.dataTransfer.dropEffect === 'none') onVoidDrop?.(tab.editorId);
  };

  return (
    <TabContextMenu
      tabCount={tabCount}
      hasFilePath={tab.filePath !== null}
      onClose={actions.onClose}
      onCloseOthers={actions.onCloseOthers}
      onCloseToRight={actions.onCloseToRight}
      onCloseSaved={actions.onCloseSaved}
      onCopyFullPath={actions.onCopyFullPath}
      onOpenContainingFolder={actions.onOpenContainingFolder}
      onRename={actions.onRename}
    >
      <div
        ref={(node) => {
          setNodeRef(node);
          // Compose dnd-kit's node ref with the reveal host ref (Phase 7).
          (reveal.hostRef as React.MutableRefObject<HTMLElement | null>).current = node;
        }}
        {...attributes}
        role="tab"
        aria-selected={active}
        className={animateEnter ? 'np-tab-enter' : undefined}
        data-testid="tab"
        data-editor-id={tab.editorId}
        data-active={active ? 'true' : 'false'}
        data-modified={tab.isModified ? 'true' : 'false'}
        data-tab-index={index}
        style={style}
        draggable={transferEnabled || undefined}
        onDragStart={transferEnabled ? onNativeDragStart : undefined}
        onDragEnd={transferEnabled ? onNativeDragEnd : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={reveal.handlers.onPointerMove}
        onMouseEnter={(e) => {
          setHovered(true);
          reveal.handlers.onPointerEnter(e as unknown as React.PointerEvent<HTMLElement>);
        }}
        onMouseLeave={() => {
          setHovered(false);
          reveal.handlers.onPointerLeave();
        }}
      >
        {/* Cursor-follow reveal highlight (Phase 7) — under the content, above the
            flat fill. pointer-events:none so it never steals tab clicks; opacity
            is driven by --reveal-opacity (0 at rest → golden-safe). */}
        <span
          aria-hidden
          data-reveal-layer="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: revealBackground,
            opacity: `var(${REVEAL_VAR_OPACITY}, 0)` as unknown as number,
            transition: 'opacity 120ms ease-out',
            zIndex: 0,
          }}
        />
        {/* Top selection indicator bar (accent), only when active. */}
        {active && (
          <span
            data-testid="tab-selection-bar"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: TabDimensions.selectionBarHeight,
              background: 'var(--tab-accent, #0078D4)',
              zIndex: 1,
            }}
          />
        )}

        {/* Unsaved-changes indicator in the left icon slot — only when dirty. A
            Segoe MDL2 "Save" glyph (E74E) sized to the 10px icon slot, replacing
            the old accent dot (F127) which was hard to read at its tiny size. */}
        <span
          aria-hidden={!tab.isModified}
          data-testid="tab-modified"
          style={{
            display: tab.isModified ? 'inline-flex' : 'none',
            width: TabDimensions.saveIconSize,
            marginRight: TabDimensions.iconMarginRight,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: SEGOE_MDL2_FONT_FAMILY,
            fontSize: TabDimensions.saveIconSize,
            lineHeight: 1,
            color: 'var(--tab-accent, #0078D4)',
            flex: '0 0 auto',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {TabGlyph.save}
        </span>

        {/* Title or inline rename input. */}
        {renaming ? (
          <input
            ref={renameRef}
            data-testid="tab-rename-input"
            defaultValue={tabTitle(tab)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename(tab.editorId, e.currentTarget.value);
              else if (e.key === 'Escape') onCancelRename();
              e.stopPropagation();
            }}
            onBlur={(e) => onCommitRename(tab.editorId, e.currentTarget.value)}
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              font: 'inherit',
              color: 'inherit',
              background: 'rgba(0,0,0,0.15)',
              border: '1px solid var(--tab-accent, #0078D4)',
              outline: 'none',
              padding: '0 2px',
              position: 'relative',
              zIndex: 1,
            }}
          />
        ) : (
          <span
            data-testid="tab-title"
            title={tab.filePath ?? tabTitle(tab)}
            onDoubleClick={() => onBeginRename(tab.editorId)}
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {tabTitle(tab)}
          </span>
        )}

        {/* Close button (E711) — reserved 24px slot, visible on hover/selected. */}
        <button
          type="button"
          data-testid="tab-close"
          aria-label={t('TabStrip_CloseTabButton.AutomationProperties.Name')}
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.editorId);
          }}
          style={{
            width: TabDimensions.closeSlotWidth,
            height: TabDimensions.closeSlotWidth,
            flex: '0 0 auto',
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'default',
            visibility: showClose ? 'visible' : 'hidden',
            fontFamily: SEGOE_MDL2_FONT_FAMILY,
            fontSize: TabDimensions.closeFontSize,
            lineHeight: 1,
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {TabGlyph.close}
        </button>
      </div>
    </TabContextMenu>
  );
}

/**
 * Memoized per-tab component. Without this, the tabs-store snapshot changing on
 * ANY mutation (setModified/setCaret/setScroll/activate/reorder) re-renders the
 * whole strip AND every tab — and during a dnd-kit drag each tab re-renders per
 * pointer tick. The store keeps unmutated tab objects referentially stable
 * (patch() only replaces the one changed tab), so this comparator re-renders a
 * tab ONLY when something it actually paints changes:
 *   - its own rendered fields (editorId / filePath / untitledName / isModified),
 *   - its position/sizing (index / width / tabCount),
 *   - its selection or rename mode (active / renaming / revealTheme / tokens),
 *   - or any handler/transfer prop identity (kept stable by the parent).
 * Mutations to caret/scroll on this or any tab — and any mutation to an
 * UNRELATED tab — therefore skip this component entirely. Returns true to SKIP
 * the re-render (props equal), false to render.
 */
const SortableTab = memo(SortableTabImpl, (prev, next): boolean => {
  return (
    prev.tab.editorId === next.tab.editorId &&
    prev.tab.filePath === next.tab.filePath &&
    prev.tab.untitledName === next.tab.untitledName &&
    prev.tab.isModified === next.tab.isModified &&
    prev.index === next.index &&
    prev.active === next.active &&
    prev.tokens === next.tokens &&
    prev.revealTheme === next.revealTheme &&
    prev.width === next.width &&
    prev.tabCount === next.tabCount &&
    prev.renaming === next.renaming &&
    prev.onActivate === next.onActivate &&
    prev.onClose === next.onClose &&
    prev.onContextActions === next.onContextActions &&
    prev.onBeginRename === next.onBeginRename &&
    prev.onCommitRename === next.onCommitRename &&
    prev.onCancelRename === next.onCancelRename &&
    prev.onBeginTransfer === next.onBeginTransfer &&
    prev.onVoidDrop === next.onVoidDrop
  );
});
function ScrollButton(props: {
  testid: string;
  glyph: string;
  ariaLabel: string;
  disabled: boolean;
  onScroll(): void;
}): JSX.Element {
  const { testid, glyph, ariaLabel, disabled, onScroll } = props;
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // Hold-to-repeat: 50ms delay, then every 100ms (UWP RepeatButton).
  const onPointerDown = (): void => {
    if (disabled) return;
    onScroll();
    timerRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(onScroll, TabScroll.repeatIntervalMs);
    }, TabScroll.repeatDelayMs);
  };

  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={ariaLabel}
      disabled={disabled}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerLeave={stop}
      style={{
        width: 32,
        height: TabDimensions.height,
        flex: '0 0 auto',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'default',
        opacity: disabled ? 0.4 : 1,
        fontFamily: SEGOE_MDL2_FONT_FAMILY,
        fontSize: 12,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glyph}
    </button>
  );
}

/**
 * Main-menu (hamburger) button — fixed to the LEFT of the strip (1:1 UWP
 * MainMenuButton, glyph GlobalNavigationButton E700, 42×32). Opens the app
 * MenuFlyout via Fluent v9 Menu primitives (NOT the preview NavDrawer, which
 * breaks under React 19). Accelerator labels are right-aligned via MenuItem
 * `secondaryContent`. Items whose command isn't implemented yet are disabled so
 * the structure mirrors UWP. Marked no-drag so the click isn't eaten by the
 * window drag region.
 */
function MainMenu(props: { tokens: TabThemeTokens; commands: MainMenuCommands }): JSX.Element {
  const { tokens, commands } = props;
  const { t } = useT();
  const [hovered, setHovered] = useState(false);
  // Recent-files list for the Open Recent submenu. Fetched from MAIN each time the
  // flyout opens (window.notepads.recent.list — most-recent-first, already pruned)
  // so it reflects files opened/saved since the last open. PA-8: window.notepads.*
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const onOpenRecent = commands.onOpenRecent;
  const refreshRecent = useCallback((): void => {
    // .catch so an IPC channel error doesn't surface as an unhandled rejection;
    // fall back to an empty list (the submenu trigger then shows disabled).
    void window.notepads.recent
      .list()
      .then((res) => {
        if (res.ok) setRecent(res.data);
        else setRecent([]);
      })
      .catch(() => setRecent([]));
  }, []);
  // Segoe MDL2 GlobalNavigationButton (E700) — the UWP MainMenuButton glyph.
  // Defined locally (not in TabGlyph) because tokens.ts is owned by another lane.
  const MENU_GLYPH = String.fromCharCode(0xe700);

  return (
    <Menu
      onOpenChange={(_e, data) => {
        // Refresh the recent list when the top-level flyout opens (only when the
        // Open Recent submenu is actually wired, to avoid a needless IPC call).
        if (data.open && onOpenRecent) refreshRecent();
      }}
    >
      <MenuTrigger disableButtonEnhancement>
        <button
          type="button"
          data-testid="main-menu-button"
          aria-label={t('MainMenuButton.AutomationProperties.Name')}
          // No app-region opt-out needed here: chrome.css already sets
          // `-webkit-app-region: no-drag` on every <button> inside the
          // [data-drag-region] strip (same as AddTabButton / scroll buttons), so
          // the click opens the flyout instead of starting a window move.
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            width: TabDimensions.addButtonWidth,
            height: TabDimensions.addButtonHeight,
            flex: '0 0 auto',
            border: 'none',
            background: hovered ? tokens.headerHover : 'transparent',
            color: tokens.textDefault,
            cursor: 'default',
            fontFamily: SEGOE_MDL2_FONT_FAMILY,
            fontSize: 16,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {MENU_GLYPH}
        </button>
      </MenuTrigger>
      <MenuPopover data-testid="main-menu-popover">
        <MenuList>
          <MenuItem secondaryContent="Ctrl+N" onClick={commands.onNew}>
            {t('MainMenu_Button_New.Text')}
          </MenuItem>
          {/* TODO: multi-window support (Ctrl+Shift+N) — disabled until wired. */}
          <MenuItem secondaryContent="Ctrl+Shift+N" disabled={!commands.onNewWindow}>
            {t('MainMenu_Button_New_Window.Text')}
          </MenuItem>
          {/* TODO: file-open dialog (Ctrl+O) — no renderer picker yet. */}
          <MenuItem secondaryContent="Ctrl+O" disabled={!commands.onOpen} onClick={commands.onOpen}>
            {t('MainMenu_Button_Open.Text')}
          </MenuItem>
          {/* Open Recent (UWP MenuOpenRecentlyUsedFileButton) — nested submenu of
              the in-app MRU. Rendered only when onOpenRecent is wired; placed
              directly after Open to mirror the UWP insert-after-Open ordering.
              Disabled when the list is empty. The whole flyout refreshes `recent`
              on open (see Menu onOpenChange). */}
          {onOpenRecent && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <MenuItem data-testid="open-recent" disabled={recent.length === 0}>
                  {t('MainMenu_Button_Open_Recent.Text')}
                </MenuItem>
              </MenuTrigger>
              <MenuPopover data-testid="open-recent-popover">
                <MenuList>
                  {recent.map((entry) => (
                    <MenuItem
                      key={entry.path}
                      data-testid="open-recent-item"
                      title={entry.path}
                      onClick={() => onOpenRecent(entry.path)}
                    >
                      {entry.displayName}
                    </MenuItem>
                  ))}
                  <MenuDivider />
                  <MenuItem
                    data-testid="open-recent-clear"
                    onClick={() => {
                      // .catch so an IPC error doesn't become an unhandled
                      // rejection; on success clear the local list immediately.
                      void window.notepads.recent
                        .clear()
                        .then((res) => {
                          if (res.ok) setRecent([]);
                        })
                        .catch(() => {});
                    }}
                  >
                    {t('MainMenu_Button_Open_Recent_ClearRecentlyOpenedSubItem_Text')}
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          )}
          <MenuDivider />
          {/* TODO: save active tab (Ctrl+S) — no renderer save handler yet. */}
          <MenuItem secondaryContent="Ctrl+S" disabled={!commands.onSave} onClick={commands.onSave}>
            {t('MainMenu_Button_Save.Text')}
          </MenuItem>
          {/* TODO: save-as (Ctrl+Shift+S) — no renderer save-as handler yet. */}
          <MenuItem
            secondaryContent="Ctrl+Shift+S"
            disabled={!commands.onSaveAs}
            onClick={commands.onSaveAs}
          >
            {t('MainMenu_Button_SaveAs.Text')}
          </MenuItem>
          <MenuItem disabled={!commands.onSaveAll} onClick={commands.onSaveAll}>
            {t('MainMenu_Button_SaveAll.Text')}
          </MenuItem>
          <MenuDivider />
          <MenuItem secondaryContent="Ctrl+F" onClick={commands.onFind}>
            {t('MainMenu_Button_Find.Text')}
          </MenuItem>
          <MenuItem secondaryContent="Ctrl+Shift+F" onClick={commands.onReplace}>
            {t('MainMenu_Button_Replace.Text')}
          </MenuItem>
          <MenuDivider />
          <MenuItem secondaryContent="F11" onClick={commands.onFullScreen}>
            {t('App_EnterFullScreenMode_Text')}
          </MenuItem>
          <MenuItem secondaryContent="F12" onClick={commands.onCompactOverlay}>
            {t('App_EnterCompactOverlayMode_Text')}
          </MenuItem>
          <MenuDivider />
          <MenuItem secondaryContent="Ctrl+P" onClick={commands.onPrint}>
            {t('MainMenu_Button_Print.Text')}
          </MenuItem>
          <MenuItem secondaryContent="Ctrl+Shift+P" onClick={commands.onPrintAll}>
            {t('MainMenu_Button_PrintAll.Text')}
          </MenuItem>
          <MenuDivider />
          <MenuItem
            secondaryContent="Ctrl+,"
            data-testid="open-settings"
            onClick={commands.onSettings}
          >
            {t('MainMenu_Button_Settings.Text')}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

/**
 * Selected-tab elevation overlay (UWP SetsView side DropShadowPanels). A box-shadow
 * on the tab element itself is clipped by the tab-list scroller and the strip
 * overflow, so it can never reach the neighbor tabs or the menu/add buttons. This
 * overlay is instead a direct child of the (overflow:visible) strip, positioned over
 * the active tab's measured rect, so its LEFT+RIGHT side shadows spill freely onto
 * the recessed neighbor tabs and the menu/add buttons.
 *
 * CRITICAL — the shadow is clipped at the BOTTOM edge. A CSS box-shadow with a blur
 * radius casts on ALL FOUR sides, not just the two offset sides: even with 0 vertical
 * offset, `blur 8` bleeds the shadow ~6px DOWNWARD past the element's bottom (the
 * strip↔editor boundary) onto the editor surface — a dark gradient line directly
 * under the selected tab. THAT was the seam ("接缝") the user kept seeing; the comment
 * here previously claimed "left+right only (no bottom)", which is false for a blurred
 * box-shadow. We clip with `inset(-16px -16px 0 -16px)`: the top/left/right insets are
 * negative (expanded) so the side blur is preserved, while the BOTTOM inset is exactly
 * 0 — the downward bleed is cut flush at the boundary. The selected-tab↔editor merge
 * is then seamless: the shared wash (App TabSurfaceWash) carries the surface across
 * the boundary, and no shadow crosses it.
 *
 * Pure presentation, pointer-events:none, aria-hidden. Renders nothing in HC
 * (alpha 0) or before the active tab is measured.
 */
function TabElevation(props: {
  rect: { left: number; width: number } | null;
  tokens: TabThemeTokens;
}): JSX.Element | null {
  const { rect, tokens } = props;
  if (!rect || tokens.elevationShadowAlpha <= 0) return null;
  const stripH = TabDimensions.height + TabDimensions.topBorderThickness;
  // Clip the downward blur flush at the bottom edge while preserving side blur.
  // top/left/right are expanded (negative) past the box so the -3/+3px offset +
  // 8px blur side shadows are not truncated; bottom is 0 so nothing bleeds onto
  // the editor below. Must be ≥ the side blur reach (offset 3 + blur 8 ≈ 11).
  const clip = 'inset(-16px -16px 0 -16px)';
  // Side-shadow frame over the active tab — left+right spill onto the recessed
  // neighbor chrome; the bottom is masked so the tab connects seamlessly to the
  // editor via the shared wash. zIndex above the tabs/buttons so it lands ON them.
  return (
    <div
      data-testid="tab-elevation"
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: rect.left,
        width: rect.width,
        height: stripH,
        pointerEvents: 'none',
        zIndex: 4,
        boxShadow: tokens.elevationShadow,
        clipPath: clip,
        WebkitClipPath: clip,
      }}
    />
  );
}

/**
 * Presentational clone of a tab for the dnd-kit DragOverlay. It carries NO
 * useSortable / interactivity — it is the floating visual that follows the cursor
 * outside the strip's overflow clip while the real (dimmed) tab stays in flow. It
 * mirrors the SortableTab look closely enough to read as "the tab, lifted out":
 * fill, modified dot, title, close-slot spacing.
 */
function TabOverlayCard(props: {
  tab: TabState;
  tokens: TabThemeTokens;
  width: number;
  active: boolean;
}): JSX.Element {
  const { tab, tokens, width, active } = props;
  const fill = active ? tokens.headerSelected : tokens.headerHover;
  const textColor = active ? tokens.textSelected : tokens.textDefault;
  return (
    <div
      data-testid="tab-overlay"
      style={{
        width,
        height: TabDimensions.height,
        paddingLeft: TabDimensions.paddingLeft,
        paddingRight: TabDimensions.paddingRight,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        background: fill,
        color: textColor,
        fontSize: 14,
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        cursor: 'grabbing',
        // Lifted look: a drop shadow so it reads as floating above the strip.
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        borderRadius: 2,
      }}
    >
      {tab.isModified ? (
        <span
          aria-hidden
          style={{
            width: TabDimensions.saveIconSize,
            marginRight: TabDimensions.iconMarginRight,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: SEGOE_MDL2_FONT_FAMILY,
            fontSize: TabDimensions.saveIconSize,
            lineHeight: 1,
            color: 'var(--tab-accent, #0078D4)',
            flex: '0 0 auto',
          }}
        >
          {TabGlyph.save}
        </span>
      ) : null}
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tabTitle(tab)}
      </span>
    </div>
  );
}

/**
 * Add-tab (+) button (E710) — fixed to the right of the strip. SetsView chrome:
 * shows the reveal grey on hover plus the cursor-follow radial highlight (Phase 7,
 * Task #27). HC reveal tint is transparent (no material), matching UWP HC.
 */
function AddTabButton(props: {
  tokens: TabThemeTokens;
  revealTheme: TabTheme;
  onNewTab(): void;
}): JSX.Element {
  const { tokens, revealTheme, onNewTab } = props;
  const [hovered, setHovered] = useState(false);
  const { t } = useT();
  const reveal = useReveal();
  const revealTokens = tokensForReveal(revealTheme);
  // Build the radial-gradient once per theme (tokensForReveal returns a stable
  // per-theme singleton), matching the SortableTab fix — not rebuilt inline on
  // every render.
  const revealBackground = useMemo(() => revealGradient(revealTokens), [revealTokens]);
  return (
    <button
      ref={reveal.hostRef as React.Ref<HTMLButtonElement>}
      type="button"
      data-testid="tab-add"
      aria-label={t('TabStrip_NewTabButton.AutomationProperties.Name')}
      onClick={onNewTab}
      onPointerMove={reveal.handlers.onPointerMove}
      onMouseEnter={(e) => {
        setHovered(true);
        reveal.handlers.onPointerEnter(e as unknown as React.PointerEvent<HTMLElement>);
      }}
      onMouseLeave={() => {
        setHovered(false);
        reveal.handlers.onPointerLeave();
      }}
      style={{
        // Pinned to the right of the strip with reserved, non-shrinkable space:
        // the tab LIST (flex:1 1 auto) scrolls under overflow, the + never gets
        // clipped or pushed off-screen (Issue 2 regression).
        width: TabDimensions.addButtonWidth,
        height: TabDimensions.addButtonHeight,
        flex: '0 0 auto',
        marginLeft: 2,
        // UWP NewSetButton is BorderThickness="0", Background="Transparent",
        // ButtonRevealStyle — NO border or radius. (A previous "affordance" hack
        // added a 1px border + radius:4; the user flagged it as wrong: "加号按钮
        // 是没有边框的".) The reveal grey below + the hover wash are the only
        // affordance, exactly like the original.
        border: 'none',
        background: hovered ? tokens.headerHover : 'transparent',
        // Full-contrast glyph (textSelected, not the dimmed textDefault) so the +
        // is legible at rest — the previous dim color is what made it "disappear".
        color: tokens.textSelected,
        cursor: 'default',
        fontFamily: SEGOE_MDL2_FONT_FAMILY,
        fontSize: TabDimensions.addGlyphSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <span
        aria-hidden
        data-reveal-layer="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: revealBackground,
          opacity: `var(${REVEAL_VAR_OPACITY}, 0)` as unknown as number,
          transition: 'opacity 120ms ease-out',
          zIndex: 0,
        }}
      />
      <span style={{ position: 'relative', zIndex: 1 }}>{TabGlyph.add}</span>
    </button>
  );
}

export function TabStrip(props: TabStripProps): JSX.Element {
  const {
    tabs,
    activeEditorId,
    store,
    isDark,
    theme,
    onNewTab,
    onCloseTab,
    onBeginTransfer,
    onVoidDrop,
    menu,
    captionSlot,
    onActiveTabGeometry,
  } = props;
  const resolvedTheme: TabTheme = theme ?? (isDark ? 'dark' : 'light');
  const tokens = tokensForTheme(resolvedTheme);

  // Root strip element — the unclipped elevation overlay is measured/positioned
  // relative to this (the overlay must be a CHILD of an overflow:visible strip so
  // its shadow can spill onto the neighbors, the menu/add buttons, and the editor
  // below; a box-shadow on the tab itself is clipped by the scroller + strip).
  const stripRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The active tab's box {left,width} in STRIP-LOCAL px (clamped to the visible
  // strip), or null until measured. Drives TabElevation: the side shadows hug
  // these edges and the strip→editor "down" shadow leaves a GAP here so the
  // selected tab merges into the editor instead of being fenced off by a line.
  const [activeRect, setActiveRect] = useState<{ left: number; width: number } | null>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [clientWidth, setClientWidth] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // True while a dnd-kit drag is in flight. We freeze the ResizeObserver
  // remeasure during a drag: dnd-kit re-renders continuously per pointer tick,
  // and a synchronous remeasure on each tick creates a RO->setState->re-render
  // ->RO feedback loop that saturates the main thread (caught by the reorder
  // e2e). Layout is stable mid-drag, so skipping the remeasure is safe.
  const draggingRef = useRef(false);
  // Mirror of draggingRef as STATE so the elevation overlay can hide itself
  // while a drag is in flight (a ref can't trigger a re-render). The overlay is
  // measured against the active tab's *resting* x; mid-drag that tab is
  // translated by dnd-kit, so a frozen overlay leaves its un-shadowed merge gap
  // stranded at the old x — the "empty bottom" hole the user saw ("拖动标签页的
  // 时候会留下一个空出来的底"). Hiding the overlay during the drag and
  // remeasuring on drop removes it; the moving tab carries its own fill.
  const [dragging, setDragging] = useState(false);
  // The id of the tab currently being dragged, so a DragOverlay can render a
  // floating, UN-clipped clone of it (the in-strip original is clipped by the tab
  // list's overflow; the overlay is portaled out so it lifts free of the strip for
  // more reorder room — UWP lets the dragged set float out of the bar).
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const closeTab = useCallback(
    (editorId: string) => {
      if (onCloseTab) onCloseTab(editorId);
      else store.close(editorId);
    },
    [onCloseTab, store],
  );

  // Equal-width algorithm (UWP ProvideEqualWidth, Equal mode):
  // single tab fills; else clamp(available / count, min, max). Fractional.
  const tabWidth = useMemo(() => {
    const n = tabs.length;
    if (n === 0) return TabDimensions.minWidth;
    if (n === 1)
      return Math.max(TabDimensions.minWidth, Math.min(stripWidth, TabDimensions.maxWidth));
    const even = stripWidth / n;
    return Math.max(TabDimensions.minWidth, Math.min(even, TabDimensions.maxWidth));
  }, [tabs.length, stripWidth]);

  // Observe the strip for resize so tab widths + overflow stay correct. We measure
  // the width AVAILABLE TO THE TABS = strip content width − the fixed chrome
  // (hamburger, scroll buttons, add button, caption slot), i.e. every direct flex
  // child except the tab list itself, the flex spacer, and the absolutely-
  // positioned elevation overlay. This mirrors the UWP SetsView grid where the
  // tab column is Width="Auto" (content-sized, capped to available) and the "*"
  // padding sits AFTER the add button — so the + hugs the last tab and slides
  // right as tabs are added, instead of being pinned to the window edge.
  // rAF-coalesced; only writes state that actually changed; frozen mid-drag.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let rafId = 0;
    let pending = false;

    const readAndCommit = (): void => {
      pending = false;
      if (draggingRef.current) return; // frozen during drag
      const stripEl = stripRef.current;
      const node = listRef.current;
      if (!stripEl || !node) return;
      // Available width for the tabs = strip content width − fixed chrome.
      let fixed = 0;
      for (const child of Array.from(stripEl.children)) {
        const el = child as HTMLElement;
        if (el === node) continue; // the tab list (sized to content / available)
        if (el.dataset.flexSpacer !== undefined) continue; // the slack-absorbing spacer
        const pos = el.style.position || getComputedStyle(el).position;
        if (pos === 'absolute' || pos === 'fixed') continue; // elevation overlay (out of flow)
        fixed += el.offsetWidth;
      }
      const avail = Math.max(0, stripEl.clientWidth - fixed);
      const cw = node.clientWidth;
      const sw = node.scrollWidth;
      const sl = node.scrollLeft;
      // Functional updaters with equality guards: no churn when unchanged.
      setStripWidth((prev) => (prev === avail ? prev : avail));
      setClientWidth((prev) => (prev === cw ? prev : cw));
      setScrollWidth((prev) => (prev === sw ? prev : sw));
      setScrollLeft((prev) => (prev === sl ? prev : sl));
    };

    const schedule = (): void => {
      if (pending) return;
      pending = true;
      rafId = requestAnimationFrame(readAndCommit);
    };

    schedule();
    // Observe the strip (available width) AND the list (its own resize/scroll
    // metrics); either changing reschedules a single coalesced read.
    const ro = new ResizeObserver(schedule);
    ro.observe(strip);
    if (listRef.current) ro.observe(listRef.current);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [tabs.length]);

  const onListScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const sl = el.scrollLeft;
    const sw = el.scrollWidth;
    const cw = el.clientWidth;
    setScrollLeft((prev) => (prev === sl ? prev : sl));
    setScrollWidth((prev) => (prev === sw ? prev : sw));
    setClientWidth((prev) => (prev === cw ? prev : cw));
  };

  // Keep the ACTIVE tab visible (UWP SetsView auto-scrolls the selected set into
  // view). When selection changes — e.g. clicking (+) repeatedly past the strip's
  // edge selects a new tab that lands outside the scroll viewport — nudge the list
  // so the active tab is fully on-screen. Keyed on selection / count / width only,
  // NOT scrollLeft, so a manual horizontal scroll is never fought (the bug:
  // clicking + selected an off-screen tab but the scrollbar didn't follow it).
  // Frozen mid-drag (dnd-kit owns scroll then) and a no-op when already visible.
  useEffect(() => {
    if (draggingRef.current) return;
    if (activeEditorId === null) return;
    const raf = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const node = list.querySelector<HTMLElement>('[data-testid="tab"][data-active="true"]');
      if (!node) return;
      const next = scrollLeftToReveal(
        list.scrollLeft,
        list.getBoundingClientRect(),
        node.getBoundingClientRect(),
        list.scrollWidth,
        list.clientWidth,
      );
      if (next !== list.scrollLeft) {
        list.scrollLeft = next;
        setScrollLeft(next);
      }
    });
    return () => cancelAnimationFrame(raf);
    // tabWidth/tabs.length/stripWidth are included so a relayout that moves the
    // active tab (added/removed sibling, resized strip) re-checks visibility.
  }, [activeEditorId, tabs.length, tabWidth, stripWidth]);

  // Joined editorId order — a reorder changes this (without changing
  // activeEditorId or length), so the active-tab measure effect below depends on
  // it to remeasure the moved tab's x. Also feeds the dnd-kit SortableContext.
  const ids = useMemo(() => tabs.map((t) => t.editorId), [tabs]);

  // New-tab entrance gating (UWP EntranceThemeTransition only plays for items that
  // ENTER, not for the set already present on first render). A tab whose id was not
  // seen on a prior render is "new" and gets the entrance animation; the initial set
  // is seeded as seen on the first render so a cold start doesn't animate everything
  // at once. The ref is updated AFTER computing the new set for this render.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const firstRender = seenIdsRef.current === null;
  if (seenIdsRef.current === null) seenIdsRef.current = new Set(ids);
  const seen = seenIdsRef.current;
  const isNewTab = (id: string): boolean => !firstRender && !seen.has(id);
  // Record current ids as seen for the next render (drop closed ids so a reused
  // editorId — should one ever recur — would re-animate as genuinely new).
  useEffect(() => {
    seenIdsRef.current = new Set(ids);
  }, [ids]);

  // Measure the active tab's box in STRIP-LOCAL coordinates so the unclipped
  // elevation overlay can hug it. Re-runs whenever anything that moves the active
  // tab changes (selection, per-tab width, scroll offset, tab count, strip width).
  // The active tab DOM node carries data-active="true"; we read both rects and
  // subtract origins, then clamp to the visible strip so a tab scrolled partly
  // out of view doesn't push the shadow past the chrome edges. rAF-coalesced and
  // frozen mid-drag (same rationale as the resize observer above).
  useEffect(() => {
    if (draggingRef.current) return;
    let raf = 0;
    const measure = (): void => {
      const strip = stripRef.current;
      if (!strip) {
        setActiveRect((p) => (p === null ? p : null));
        return;
      }
      const node = strip.querySelector<HTMLElement>('[data-testid="tab"][data-active="true"]');
      if (!node) {
        setActiveRect((p) => (p === null ? p : null));
        return;
      }
      const sb = strip.getBoundingClientRect();
      const tb = node.getBoundingClientRect();
      // The visible window for tabs is the LIST's box, NOT the whole strip: the
      // strip also holds the hamburger + scroll-left button (left of the list) and
      // the add button + caption (right of it). getBoundingClientRect ignores the
      // list's overflow clip, so a tab scrolled out the list's left edge still
      // reports its true (off-list) geometry. Clamping to the strip [0, sb.width]
      // then pinned the overlay's left to strip-x=0 — painting the selected-tab
      // elevation OVER the hamburger/scroll chrome as a stray translucent block
      // (the bug: "选中效果...其他组件会突出来一个透明的块"). clampOverlayToList
      // clamps to the list's own edges instead, so the overlay tracks only the
      // in-list visible portion and vanishes (null) once the tab is fully scrolled
      // out of the list viewport.
      const lb = listRef.current ? listRef.current.getBoundingClientRect() : sb;
      const next = clampOverlayToList(sb, lb, tb);
      setActiveRect((prev) =>
        prev && next && prev.left === next.left && prev.width === next.width
          ? prev
          : (next ?? (prev === null ? prev : null)),
      );
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
    // `ids` (the joined editorId order) is included so a REORDER — which moves the
    // active tab without changing activeEditorId/length — remeasures its new x.
    // `dragging` is included so dropping (dragging:true→false) re-runs the effect
    // and remeasures the active tab at its new resting position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditorId, tabWidth, scrollLeft, tabs.length, stripWidth, resolvedTheme, ids, dragging]);

  // Report the active tab's geometry to the host (App) so the single continuous
  // wash layer behind the strip + editor can notch up under exactly this rect.
  // Mid-drag we report null so the notch retracts (the dragged tab is translated
  // away from the measured rect; a stale notch would strand under the old x — the
  // same "empty bottom" the elevation overlay avoids by hiding). On drop, dragging
  // flips false, the measure effect above re-runs, activeRect updates, and this
  // re-emits the resting rect.
  useEffect(() => {
    if (!onActiveTabGeometry) return;
    onActiveTabGeometry(dragging ? null : activeRect);
  }, [onActiveTabGeometry, activeRect, dragging]);

  const scrollableWidth = Math.max(0, scrollWidth - clientWidth);
  // Chevrons show only when scrollableWidth exceeds the threshold (UWP: 65px).
  const showScrollButtons = scrollableWidth > TabScroll.showThreshold;
  const atStart = scrollLeft <= TabScroll.endTolerance;
  const atEnd = scrollLeft >= scrollableWidth - TabScroll.endTolerance;

  const scrollBy = (delta: number): void => {
    const el = listRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, Math.min(el.scrollLeft + delta, scrollableWidth));
    setScrollLeft(el.scrollLeft);
  };

  // dnd-kit: start dragging only after a small movement so clicks still register.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent): void => {
    draggingRef.current = true;
    setDragging(true);
    setActiveDragId(String(e.active.id));
  };

  const onDragEnd = (e: DragEndEvent): void => {
    draggingRef.current = false;
    setDragging(false);
    setActiveDragId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      store.reorderById(String(active.id), String(over.id));
    }
  };

  const onDragCancel = (): void => {
    draggingRef.current = false;
    setDragging(false);
    setActiveDragId(null);
  };

  // Build the context-menu action closures for a given tab.
  const onContextActions = useCallback(
    (tab: TabState) => ({
      onClose: () => closeTab(tab.editorId),
      onCloseOthers: () => store.closeOthers(tab.editorId),
      onCloseToRight: () => store.closeToRight(tab.editorId),
      onCloseSaved: () => store.closeSaved(),
      onCopyFullPath: () => {
        if (tab.filePath) void window.notepads.shell.copyPath(tab.filePath);
      },
      onOpenContainingFolder: () => {
        if (tab.filePath) void window.notepads.shell.openContainingFolder(tab.filePath);
      },
      onRename: () => setRenamingId(tab.editorId),
    }),
    [closeTab, store],
  );

  const commitRename = useCallback(
    (editorId: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        const tab = store.get(editorId);
        // Untitled buffers rename in-place; saved files defer to file IO (Phase 4).
        if (tab && tab.filePath === null) store.setUntitledName(editorId, trimmed);
      }
      setRenamingId(null);
    },
    [store],
  );

  // Stable per-tab callbacks so the memoized SortableTab isn't forced to
  // re-render by a fresh closure on every parent render. Each only closes over
  // stable refs (store / the setRenamingId setter), so useCallback with an empty
  // (or store-only) dep list is safe.
  const activateTab = useCallback((id: string) => store.activate(id), [store]);
  const beginRename = useCallback((id: string) => setRenamingId(id), []);
  const cancelRename = useCallback(() => setRenamingId(null), []);

  // F2 (routed from useTabKeyboard via a window event) begins inline rename on
  // the active tab without TabStrip needing the keyboard hook itself.
  useEffect(() => {
    const onBeginRename = (e: Event): void => {
      const detail = (e as CustomEvent<{ editorId: string }>).detail;
      if (detail?.editorId) setRenamingId(detail.editorId);
    };
    window.addEventListener('notepads:begin-rename', onBeginRename);
    return () => window.removeEventListener('notepads:begin-rename', onBeginRename);
  }, []);

  return (
    <div
      ref={stripRef}
      data-testid="tab-strip"
      data-theme={resolvedTheme}
      data-drag-region
      style={
        {
          display: 'flex',
          alignItems: 'stretch',
          height: TabDimensions.height + TabDimensions.topBorderThickness,
          // border-box so the 1px top border is INSIDE the height: the flex content
          // area is exactly TabDimensions.height (32px), so the tabs fill it with no
          // leftover strip-background sliver under them. With the default content-box
          // the 32px tabs left a 1px strip line at the bottom edge — the visible
          // seam between the selected tab and the editor (the tab stopped 1px short
          // of the content sheet). border-box closes that gap.
          boxSizing: 'border-box',
          background: tokens.stripBackground,
          borderTop: `${TabDimensions.topBorderThickness}px solid ${tokens.topBorder}`,
          // overflow:visible (not hidden) so the unclipped TabElevation overlay can
          // cast the selected-tab shadow DOWN onto the editor and sideways onto the
          // menu/add buttons. The inner tab-list keeps its own overflowX:auto, so
          // tabs still scroll/clip there — only the absolutely-positioned elevation
          // overlay escapes. position:relative + a z-index above #app-shell (which
          // is z:auto) lets that downward shadow land on the editor surface below.
          position: 'relative',
          overflow: 'visible',
          zIndex: 3,
          // Expose the accent so the selection bar + modified dot inherit it
          // (HC maps this to the Highlight system color).
          ['--tab-accent' as string]: tokens.accent,
        } as React.CSSProperties
      }
    >
      {/* Main-menu (hamburger) button — LEFT of the tab strip (UWP MainMenuButton). */}
      {menu && <MainMenu tokens={tokens} commands={menu} />}

      {showScrollButtons && (
        <ScrollButton
          testid="tab-scroll-left"
          glyph={TabGlyph.scrollLeft}
          ariaLabel="Scroll tabs left"
          disabled={atStart}
          onScroll={() => scrollBy(-TabScroll.amount)}
        />
      )}

      <div
        ref={listRef}
        role="tablist"
        data-testid="tab-list"
        onScroll={onListScroll}
        style={{
          display: 'flex',
          alignItems: 'stretch',
          // Content-sized but capped to the available width (UWP tab column is
          // Width="Auto" + ConstrainColumn): the list is only as wide as its tabs
          // until they exceed the space, then it caps and scrolls internally. This
          // is what lets the add button sit flush against the last tab (the "*"
          // spacer AFTER the + absorbs the remaining width) instead of the list
          // stretching full-width and pushing the + to the window edge.
          flex: '0 1 auto',
          minWidth: 0,
          maxWidth: stripWidth > 0 ? stripWidth : undefined,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
        }}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, index) => (
              <SortableTab
                key={tab.editorId}
                tab={tab}
                index={index}
                active={tab.editorId === activeEditorId}
                tokens={tokens}
                revealTheme={resolvedTheme}
                width={tabWidth}
                tabCount={tabs.length}
                animateEnter={isNewTab(tab.editorId)}
                renaming={renamingId === tab.editorId}
                onActivate={activateTab}
                onClose={closeTab}
                onContextActions={onContextActions}
                onBeginRename={beginRename}
                onCommitRename={commitRename}
                onCancelRename={cancelRename}
                onBeginTransfer={onBeginTransfer}
                onVoidDrop={onVoidDrop}
              />
            ))}
          </SortableContext>
          {/* Floating clone of the dragged tab, portaled OUTSIDE the strip's overflow
              clip so it lifts free of the bar for more reorder room. dropAnimation is
              kept short; the in-flow original is dimmed (opacity 0.6) by SortableTab. */}
          <DragOverlay dropAnimation={{ duration: TabAnimation.settleMs, easing: 'ease' }}>
            {activeDragId
              ? (() => {
                  const t = tabs.find((x) => x.editorId === activeDragId);
                  if (!t) return null;
                  return (
                    <TabOverlayCard
                      tab={t}
                      tokens={tokens}
                      width={tabWidth}
                      active={t.editorId === activeEditorId}
                    />
                  );
                })()
              : null}
          </DragOverlay>
        </DndContext>
      </div>

      {showScrollButtons && (
        <ScrollButton
          testid="tab-scroll-right"
          glyph={TabGlyph.scrollRight}
          ariaLabel="Scroll tabs right"
          disabled={atEnd}
          onScroll={() => scrollBy(TabScroll.amount)}
        />
      )}

      {/* Add-tab button (E710) — sits flush against the last tab (UWP
          SetsActionHeader, immediately after the Width="Auto" tab column). */}
      <AddTabButton tokens={tokens} revealTheme={resolvedTheme} onNewTab={onNewTab} />

      {/* Flex spacer (UWP's Width="*" padding column, placed AFTER the add button):
          absorbs the remaining strip width so the + hugs the tabs and the caption
          slot is pushed to the window's right edge. It is also the draggable empty
          band of the title bar. Excluded from the available-width sum (data-flex-
          spacer) so it never feeds back into the tab sizing. */}
      <div data-flex-spacer="true" style={{ flex: '1 1 auto', minWidth: 0 }} />

      {/* Custom window caption controls (min/max/close), flush at the window's
          top-right corner. Pulled up over the strip's 1px top border so the
          buttons span the full caption height from y=0 (matching the OS caption
          band they replace). no-drag is set on the buttons themselves. */}
      {captionSlot && (
        <div
          data-testid="caption-slot"
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'stretch',
            marginTop: -TabDimensions.topBorderThickness,
          }}
        >
          {captionSlot}
        </div>
      )}

      {/* Unclipped selected-tab elevation (side shadows + strip→editor merge).
          Last child so it paints over the tabs/buttons; positioned over the
          measured active-tab rect. Hidden mid-drag (the dragged tab is
          translated away from the measured rect, so a frozen overlay would
          strand its merge gap as an "empty bottom" hole); remeasured on drop.
          Renders nothing in HC or before measurement. */}
      {!dragging && <TabElevation rect={activeRect} tokens={tokens} />}
    </div>
  );
}
