import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TabState } from './types';
import type { TabsStore } from './useTabsStore';
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
}

/** The label a tab shows: basename of filePath, else its untitled name. */
function tabTitle(tab: TabState): string {
  if (tab.filePath === null) return tab.untitledName || 'Untitled';
  // Renderer has no Node basename helper (PA-8); split on both separators here.
  const parts = tab.filePath.split(/[\\/]/);
  return parts[parts.length - 1] || tab.filePath;
}

interface SortableTabProps {
  tab: TabState;
  index: number;
  active: boolean;
  tokens: TabThemeTokens;
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
  /** Cross-window transfer hooks (optional; see TabStripProps). */
  onBeginTransfer?(editorId: string): Promise<string | null>;
  onVoidDrop?(editorId: string): void;
}

function SortableTab(props: SortableTabProps): JSX.Element {
  const {
    tab,
    index,
    active,
    tokens,
    width,
    tabCount,
    renaming,
    onActivate,
    onClose,
    onContextActions,
    onBeginRename,
    onCommitRename,
    onCancelRename,
    onBeginTransfer,
    onVoidDrop,
  } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.editorId,
  });
  const [hovered, setHovered] = useState(false);
  const renameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  // Close button visible on hover OR selected (UWP CommonStates).
  const showClose = hovered || active;
  const fill = active ? tokens.headerSelected : hovered ? tokens.headerHover : 'transparent';
  const textColor = active ? tokens.textSelected : tokens.textDefault;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? `transform ${TabAnimation.reorderMs}ms`,
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
    color: textColor,
    cursor: 'default',
    userSelect: 'none',
    opacity: isDragging ? 0.6 : 1,
    fontSize: 13,
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
        ref={setNodeRef}
        {...attributes}
        role="tab"
        aria-selected={active}
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
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
            }}
          />
        )}

        {/* Modified dot (F127) in the left icon slot — only when dirty. */}
        <span
          aria-hidden={!tab.isModified}
          data-testid="tab-modified"
          style={{
            display: tab.isModified ? 'inline-flex' : 'none',
            width: TabDimensions.iconSize,
            marginRight: TabDimensions.iconMarginRight,
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: SEGOE_MDL2_FONT_FAMILY,
            fontSize: TabDimensions.modifiedDotSize,
            color: 'var(--tab-accent, #0078D4)',
            flex: '0 0 auto',
          }}
        >
          {TabGlyph.modifiedDot}
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
            }}
          >
            {tabTitle(tab)}
          </span>
        )}

        {/* Close button (E711) — reserved 24px slot, visible on hover/selected. */}
        <button
          type="button"
          data-testid="tab-close"
          aria-label="Close tab"
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
          }}
        >
          {TabGlyph.close}
        </button>
      </div>
    </TabContextMenu>
  );
}

/** A scroll-overflow chevron button (E76B / E76C). Hidden when not overflowing. */
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

export function TabStrip(props: TabStripProps): JSX.Element {
  const { tabs, activeEditorId, store, isDark, theme, onNewTab, onCloseTab, onBeginTransfer, onVoidDrop } =
    props;
  const resolvedTheme: TabTheme = theme ?? (isDark ? 'dark' : 'light');
  const tokens = tokensForTheme(resolvedTheme);

  const listRef = useRef<HTMLDivElement | null>(null);
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
    if (n === 1) return Math.max(TabDimensions.minWidth, Math.min(stripWidth, TabDimensions.maxWidth));
    const even = stripWidth / n;
    return Math.max(TabDimensions.minWidth, Math.min(even, TabDimensions.maxWidth));
  }, [tabs.length, stripWidth]);

  // Observe the list region for resize so widths + overflow stay correct.
  // The measure is rAF-coalesced (one read per frame regardless of how many
  // notifications fire) and only writes state that actually changed, so a
  // resize never triggers an unbounded re-measure cascade.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let rafId = 0;
    let pending = false;

    const readAndCommit = (): void => {
      pending = false;
      if (draggingRef.current) return; // frozen during drag
      const node = listRef.current;
      if (!node) return;
      const cw = node.clientWidth;
      const sw = node.scrollWidth;
      const sl = node.scrollLeft;
      // Functional updaters with equality guards: no churn when unchanged.
      setStripWidth((prev) => (prev === cw ? prev : cw));
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
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
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

  const onDragStart = (): void => {
    draggingRef.current = true;
  };

  const onDragEnd = (e: DragEndEvent): void => {
    draggingRef.current = false;
    const { active, over } = e;
    if (over && active.id !== over.id) {
      store.reorderById(String(active.id), String(over.id));
    }
  };

  const onDragCancel = (): void => {
    draggingRef.current = false;
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

  const ids = useMemo(() => tabs.map((t) => t.editorId), [tabs]);

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
      data-testid="tab-strip"
      data-theme={resolvedTheme}
      style={
        {
          display: 'flex',
          alignItems: 'stretch',
          height: TabDimensions.height + TabDimensions.topBorderThickness,
          background: tokens.stripBackground,
          borderTop: `${TabDimensions.topBorderThickness}px solid ${tokens.topBorder}`,
          overflow: 'hidden',
          // Expose the accent so the selection bar + modified dot inherit it
          // (HC maps this to the Highlight system color).
          ['--tab-accent' as string]: tokens.accent,
        } as React.CSSProperties
      }
    >
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
          flex: '1 1 auto',
          minWidth: 0,
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
                width={tabWidth}
                tabCount={tabs.length}
                renaming={renamingId === tab.editorId}
                onActivate={(id) => store.activate(id)}
                onClose={closeTab}
                onContextActions={onContextActions}
                onBeginRename={(id) => setRenamingId(id)}
                onCommitRename={commitRename}
                onCancelRename={() => setRenamingId(null)}
                onBeginTransfer={onBeginTransfer}
                onVoidDrop={onVoidDrop}
              />
            ))}
          </SortableContext>
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

      {/* Add-tab button (E710) — fixed to the right of the strip. */}
      <button
        type="button"
        data-testid="tab-add"
        aria-label="New tab"
        onClick={onNewTab}
        style={{
          width: TabDimensions.addButtonWidth,
          height: TabDimensions.addButtonHeight,
          flex: '0 0 auto',
          marginLeft: -1,
          border: 'none',
          background: 'transparent',
          color: tokens.textDefault,
          cursor: 'default',
          fontFamily: SEGOE_MDL2_FONT_FAMILY,
          fontSize: TabDimensions.addGlyphSize,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {TabGlyph.add}
      </button>
    </div>
  );
}
