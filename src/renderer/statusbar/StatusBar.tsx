import {
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuDivider,
  Slider
} from '@fluentui/react-components';
import { useState, createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { FC } from 'react';
import type { AnsiEncodingEntry, EncodingId, EolId } from '@shared/ipc-contract';
import {
  StatusGlyph,
  StatusDimensions,
  tokensForStatusTheme,
  type StatusTheme,
  type StatusThemeTokens
} from './tokens';
import { useReveal, revealGradient, tokensForReveal, REVEAL_VAR_OPACITY } from '../theme/reveal';
import { useT } from '../i18n';
import { ThemedMenuPopover } from '../theme/ThemedMenuPopover';
import { getFolderBasename } from '../integrations/pathUtils';
import {
  formatLineColumn,
  eolDisplayText,
  EOL_MENU_ROWS,
  buildEncodingMenuModel,
  type LineColumn
} from './statusModel';

/**
 * ============================================================================
 *  StatusBar — from-scratch 8-column port (Phase 4, stream C)
 * ============================================================================
 *
 * 1:1 port of the UWP NotepadsMainPage.xaml `StatusBar` Grid (lines 270-417) +
 * the StatusBar.cs code-behind that assigns its glyphs/flyouts. Column order is
 * verbatim (Grid.ColumnDefinitions: Auto/* /Auto x6):
 *
 *   0  FileModificationStateIndicator  — E7BA modified-outside / E9CE renamed
 *   1  PathIndicator (+ flyout)        — reload E72C, copy E8C8, folder ED25, rename E8AC
 *   2  ModificationIndicator (+ flyout)— preview E89A, revert E7A7
 *   3  LineColumnIndicator (+ go-to)   — "Ln x, Col y (n selected)"
 *   4  FontZoomIndicator (+ slider)    — zoom 10-500, E108 out / E109 in
 *   5  LineEndingIndicator (menu)      — CRLF / CR / LF
 *   6  EncodingIndicator (menu)        — dynamic Unicode + "More encodings"
 *   7  ShadowWindowIndicator           — E737, shown only on non-primary windows
 *
 * Visuals are the hardcoded theme tokens from ./tokens (Dark #2E2E2E / Light
 * #F0F0F0), 25px height, 11px font, "8,4" text padding, hover-reveal overlay
 * (UWP PointerEntered paints SystemRevealListLowColor). The display/format logic
 * lives in ./statusModel (pure, unit-tested); this file is the React surface.
 *
 * PA-8: renderer-only. Every action routes through window.notepads.* — no fs,
 * child_process, or path imports. Column 0/1/2 file actions go through
 * window.notepads.shell / window.notepads.file the same way the strip does.
 */

// ---------------------------------------------------------------------------
//  Props — the view model App populates from the active tab + editor state
// ---------------------------------------------------------------------------

/** File-modification state for column 0 (mirrors UWP FileModificationState). */
export type FileModificationState = 'none' | 'modifiedOutside' | 'renamedMovedDeleted';

export interface StatusBarProps {
  /** Theme selector ('hc' = forced-colors high contrast). */
  theme: StatusTheme;
  /** Column 0: external-modification state. 'none' hides the indicator. */
  fileModificationState: FileModificationState;
  /** Column 1: absolute path of the active file, or null for an untitled buffer. */
  filePath: string | null;
  /** Column 1: placeholder shown when filePath is null (e.g. "Untitled 1"). */
  fileNamePlaceholder: string;
  /** Column 2: true when the active buffer has unsaved edits. */
  isModified: boolean;
  /** Column 3: derived 1-based line/column + selected-character count. */
  lineColumn: LineColumn;
  /** Column 4: current zoom factor as a percentage (10-500). */
  zoomPercent: number;
  /** Column 5: opaque EOL label from MAIN (never re-derived). */
  eolId: EolId;
  /** Column 6: opaque encoding label from MAIN (never re-derived). */
  encodingId: EncodingId;
  /** Column 6: ANSI table MAIN returns (drives "More encodings"). */
  ansiEncodings: readonly AnsiEncodingEntry[];
  /** Column 7: true on a non-primary (shadow) window. */
  isShadowWindow: boolean;
  /** View mode selector: which rendering mode is active for the current tab. */
  viewMode: { preview: boolean; diff: boolean };
  /** Set the view mode for the current tab. */
  onSetViewMode(mode: { preview: boolean; diff: boolean }): void;
  /** Currently open folder path, or null when no folder is open. */
  folderPath: string | null;
  /** Toggle the folder sidebar open (or reopen if closed). */
  onToggleFolder(): void;

  // --- actions (all renderer-safe; the host wires them to window.notepads) ---
  /** Column 0/1: reload the file from disk. */
  onReloadFromDisk(): void;
  /** Column 1: copy the full path to the clipboard. */
  onCopyFullPath(): void;
  /** Column 1: open the containing folder. */
  onOpenContainingFolder(): void;
  /** Column 1: rename the active file. */
  onRename(): void;
  /** Column 2: open the diff/preview of pending changes. */
  onPreviewChanges(): void;
  /** Column 2: revert all unsaved changes. */
  onRevertAllChanges(): void;
  /** Column 3: open the go-to-line dialog. */
  onGoToLine(): void;
  /** Column 4: set the editor zoom factor (percentage, 10-500). */
  onSetZoom(percent: number): void;
  /** Column 4: restore the default 100% zoom. */
  onResetZoom(): void;
  /** Column 4: the zoom slider drag began (pauses the poll's zoom read). */
  onZoomDragStart(): void;
  /** Column 4: the zoom slider drag ended (resumes + settles the zoom read). */
  onZoomDragEnd(): void;
  /** Column 5: re-apply a new EOL style to the active buffer. */
  onChangeEol(eol: EolId): void;
  /** Column 6: re-open the active file decoded with a different encoding. */
  onReopenWithEncoding(encodingId: EncodingId): void;
  /** Column 6: save the active file with a different encoding. */
  onSaveWithEncoding(encodingId: EncodingId): void;
}

// ---------------------------------------------------------------------------
//  Shared sizing constants (the SHIPPING values, from tokens.StatusDimensions)
// ---------------------------------------------------------------------------

/** Min/max zoom percentage (UWP FontZoomSlider Minimum=10 Maximum=500). */
const ZOOM_MIN = 10;
const ZOOM_MAX = 500;
const ZOOM_DEFAULT = 100;

// ---------------------------------------------------------------------------
//  A clickable status-bar cell with the UWP hover-reveal overlay
// ---------------------------------------------------------------------------

interface CellProps {
  tokens: StatusThemeTokens;
  testid: string;
  /** Accessible label for the cell's interactive role. */
  ariaLabel?: string;
  /** Override the default "8,4" text padding (PathIndicator uses left 4). */
  padLeft?: number;
  /** Click handler (cells with flyouts pass it to the menu trigger instead). */
  onClick?: () => void;
  /** When true, render as a non-interactive container (column 7 shadow icon). */
  static?: boolean;
  /**
   * Hover affordance. 'background' (default) paints the UWP reveal-low tint
   * instantly; 'opacity' dims the cell to 0.7 instead (the UWP PathIndicator
   * PointerEntered drops Opacity, it never paints a background).
   */
  hoverEffect?: 'background' | 'opacity';
  title?: string;
  children: ReactNode;
}

/**
 * One status-bar cell. Interactive cells reveal the hover overlay on
 * PointerEntered (UWP SystemRevealListLowColor) and expose role="button". Cells
 * wrapped by a Fluent Menu pass `onClick` undefined and let the trigger handle
 * activation; the overlay still tracks hover for visual parity.
 */
/**
 * The resolved status-bar theme, shared with every Cell so the cursor-follow
 * reveal layer (Phase 7) picks the right tint without threading the theme string
 * through all 8 column components. Defaults to 'light'; StatusBar provides it.
 */
const StatusRevealThemeContext = createContext<StatusTheme>('light');

function Cell(props: CellProps): JSX.Element {
  const { tokens, testid, ariaLabel, padLeft, onClick, title, children } = props;
  const isStatic = props.static ?? false;
  const hoverEffect = props.hoverEffect ?? 'background';
  const [hovered, setHovered] = useState(false);
  // Cursor-follow reveal highlight (Phase 7, Task #27). Interactive cells track
  // the pointer into --reveal-x/y/opacity for the radial layer below; static
  // cells (col 7 shadow icon) get no reveal. HC tint is transparent (no material).
  const reveal = useReveal();
  const revealTokens = tokensForReveal(useContext(StatusRevealThemeContext));

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    height: StatusDimensions.height,
    boxSizing: 'border-box',
    paddingLeft: padLeft ?? StatusDimensions.padX,
    paddingRight: StatusDimensions.padX,
    fontSize: StatusDimensions.fontSize,
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    lineHeight: 1,
    color: tokens.text,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    // UWP status-bar segments show the hand cursor (Core PointerCursor "Hand").
    cursor: isStatic ? 'default' : 'pointer',
    position: 'relative',
    overflow: 'hidden',
    // Hover affordances are INSTANT (no transition) — UWP PointerEntered swaps
    // the brush in one frame. 'background' paints reveal-low; 'opacity' dims to
    // 0.7 (the PathIndicator behavior — UWP never tints the path cell).
    opacity: !isStatic && hoverEffect === 'opacity' && hovered ? 0.7 : 1,
    background: !isStatic && hoverEffect === 'background' && hovered ? tokens.hover : 'transparent'
  };

  return (
    <div
      ref={isStatic ? undefined : (reveal.hostRef as React.Ref<HTMLDivElement>)}
      data-testid={testid}
      role={isStatic ? undefined : 'button'}
      aria-label={ariaLabel}
      tabIndex={isStatic ? undefined : 0}
      title={title}
      style={style}
      onMouseEnter={(e) => {
        setHovered(true);
        if (!isStatic)
          reveal.handlers.onPointerEnter(e as unknown as React.PointerEvent<HTMLElement>);
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (!isStatic) reveal.handlers.onPointerLeave();
      }}
      onPointerMove={isStatic ? undefined : reveal.handlers.onPointerMove}
      onClick={isStatic ? undefined : onClick}
      onKeyDown={
        isStatic || !onClick
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
      }
    >
      {!isStatic && (
        <span
          aria-hidden
          data-reveal-layer="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: revealGradient(revealTokens),
            opacity: `var(${REVEAL_VAR_OPACITY}, 0)` as unknown as number,
            transition: 'opacity 120ms ease-out',
            zIndex: 0
          }}
        />
      )}
      <span
        style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center' }}
      >
        {children}
      </span>
    </div>
  );
}

function Glyph(props: { icon: FC; color?: string }): JSX.Element {
  const Icon = props.icon;
  return (
    <span
      aria-hidden
      style={{
        fontSize: StatusDimensions.iconSize,
        lineHeight: 1,
        color: props.color
      }}
    >
      <Icon />
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Column 0 — FileModificationStateIndicator (E7BA / E9CE)
// ---------------------------------------------------------------------------

function ModificationStateColumn(props: {
  tokens: StatusThemeTokens;
  state: FileModificationState;
  onReloadFromDisk: () => void;
}): JSX.Element | null {
  const { tokens, state, onReloadFromDisk } = props;
  const { t } = useT();
  // 'none' renders an empty Auto/MinWidth-4 column placeholder (UWP MinWidth=4).
  if (state === 'none') {
    return (
      <div data-testid="status-mod-state" style={{ minWidth: StatusDimensions.col0MinWidth }} />
    );
  }
  const glyph =
    state === 'modifiedOutside' ? StatusGlyph.fileModified : StatusGlyph.fileRenamedMovedDeleted;
  const label =
    state === 'modifiedOutside'
      ? t('TextEditor_FileModifiedOutsideIndicator_ToolTip')
      : t('TextEditor_FileRenamedMovedOrDeletedIndicator_ToolTip');

  // Modified-outside offers a one-item flyout to reload (E72C); renamed/moved/
  // deleted is informational (UWP shows the same reload affordance via the path
  // flyout, so we keep this cell click = reload for parity).
  return (
    <Menu positioning="above-start">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-mod-state"
            ariaLabel={label}
            title={label}
            padLeft={StatusDimensions.modStatePadLeft}
          >
            <Glyph icon={glyph} color={tokens.accent} />
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList data-testid="status-mod-state-menu">
          <MenuItem
            data-testid="status-mod-state-reload"
            icon={<Glyph icon={StatusGlyph.reload} />}
            onClick={onReloadFromDisk}
          >
            {t('TextEditor_FileModifiedOutsideIndicator_MenuFlyoutItem_ReloadFileFromDisk.Text')}
          </MenuItem>
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Column 1 — PathIndicator + flyout (E72C / E8C8 / ED25 / E8AC)
// ---------------------------------------------------------------------------

function PathColumn(props: {
  tokens: StatusThemeTokens;
  filePath: string | null;
  placeholder: string;
  onReloadFromDisk: () => void;
  onCopyFullPath: () => void;
  onOpenContainingFolder: () => void;
  onRename: () => void;
}): JSX.Element {
  const { tokens, filePath, placeholder } = props;
  const { t } = useT();
  const hasFile = filePath !== null;
  const text = filePath ?? placeholder;

  return (
    <Menu positioning="above-start">
      <MenuTrigger disableButtonEnhancement>
        <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
          <Cell
            tokens={tokens}
            testid="status-path"
            ariaLabel={t('StatusBar_FilePath')}
            title={text}
            padLeft={StatusDimensions.pathPadLeft}
            hoverEffect="opacity"
          >
            <span
              data-testid="status-path-text"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
            >
              {text}
            </span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList data-testid="status-path-menu">
          <MenuItem
            data-testid="status-path-reload"
            disabled={!hasFile}
            icon={<Glyph icon={StatusGlyph.reload} />}
            onClick={props.onReloadFromDisk}
          >
            {t('TextEditor_FileModifiedOutsideIndicator_MenuFlyoutItem_ReloadFileFromDisk.Text')}
          </MenuItem>
          <MenuItem
            data-testid="status-path-copy"
            disabled={!hasFile}
            icon={<Glyph icon={StatusGlyph.copyPath} />}
            onClick={props.onCopyFullPath}
          >
            {t('Tab_ContextFlyout_CopyFullPathButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="status-path-folder"
            disabled={!hasFile}
            icon={<Glyph icon={StatusGlyph.openFolder} />}
            onClick={props.onOpenContainingFolder}
          >
            {t('Tab_ContextFlyout_OpenContainingFolderButtonDisplayText')}
          </MenuItem>
          <MenuItem
            data-testid="status-path-rename"
            disabled={!hasFile}
            icon={<Glyph icon={StatusGlyph.rename} />}
            onClick={props.onRename}
          >
            {t('Tab_ContextFlyout_RenameButtonDisplayText')}
          </MenuItem>
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Column 2 — ModificationIndicator + flyout (E89A / E7A7)
// ---------------------------------------------------------------------------

function ModificationColumn(props: {
  tokens: StatusThemeTokens;
  isModified: boolean;
  onPreviewChanges: () => void;
  onRevertAllChanges: () => void;
}): JSX.Element | null {
  const { tokens, isModified } = props;
  const { t } = useT();
  // UWP shows "Modified" only when the buffer is dirty; otherwise the column is
  // collapsed (empty Auto width).
  if (!isModified) {
    return <div data-testid="status-modification" />;
  }
  return (
    <Menu positioning="above-end">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-modification"
            ariaLabel={t('TextEditor_ModificationIndicator_Text')}
            title={t('TextEditor_ModificationIndicator_Text')}
          >
            <span style={{ color: tokens.accent }}>
              {t('TextEditor_ModificationIndicator_Text')}
            </span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList data-testid="status-modification-menu">
          <MenuItem
            data-testid="status-modification-preview"
            icon={<Glyph icon={StatusGlyph.previewChanges} />}
            onClick={props.onPreviewChanges}
          >
            {t('TextEditor_ModificationIndicator_MenuFlyoutItem_PreviewTextChanges.Text')}
          </MenuItem>
          <MenuItem
            data-testid="status-modification-revert"
            icon={<Glyph icon={StatusGlyph.revert} />}
            onClick={props.onRevertAllChanges}
          >
            {t('TextEditor_ModificationIndicator_MenuFlyoutItem_RevertAllChanges.Text')}
          </MenuItem>
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Column 3 (new) — ViewModeColumn (Source / Preview / Diff)
// ---------------------------------------------------------------------------

function ViewModeColumn(props: {
  tokens: StatusThemeTokens;
  viewMode: { preview: boolean; diff: boolean };
  onSetViewMode: (mode: { preview: boolean; diff: boolean }) => void;
}): JSX.Element {
  const { tokens, viewMode, onSetViewMode } = props;
  const { t } = useT();
  const label = viewMode.preview
    ? t('StatusBar_ViewMode_Preview')
    : viewMode.diff
      ? t('StatusBar_ViewMode_Diff')
      : t('StatusBar_ViewMode_Source');

  return (
    <Menu positioning="above-end">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-viewmode"
            ariaLabel={t('StatusBar_ViewMode')}
            title={label}
          >
            <span data-testid="status-viewmode-text">{label}</span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList data-testid="status-viewmode-menu">
          <MenuItem
            data-testid="status-viewmode-source"
            onClick={() => onSetViewMode({ preview: false, diff: false })}
          >
            {t('StatusBar_ViewMode_Source')}
          </MenuItem>
          <MenuItem
            data-testid="status-viewmode-preview"
            onClick={() => onSetViewMode({ preview: true, diff: false })}
          >
            {t('StatusBar_ViewMode_Preview')}
          </MenuItem>
          <MenuItem
            data-testid="status-viewmode-diff"
            onClick={() => onSetViewMode({ preview: false, diff: true })}
          >
            {t('StatusBar_ViewMode_Diff')}
          </MenuItem>
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Column 3 — LineColumnIndicator (click = go-to-line)
// ---------------------------------------------------------------------------

function LineColumnColumn(props: {
  tokens: StatusThemeTokens;
  lineColumn: LineColumn;
  onGoToLine: () => void;
}): JSX.Element {
  const { tokens, lineColumn, onGoToLine } = props;
  const { t } = useT();
  return (
    <Cell
      tokens={tokens}
      testid="status-linecol"
      ariaLabel={t('StatusBar_LineColumnGoTo')}
      onClick={onGoToLine}
    >
      <span data-testid="status-linecol-text">{formatLineColumn(lineColumn)}</span>
    </Cell>
  );
}

// ---------------------------------------------------------------------------
//  Column 4 — FontZoomIndicator + slider flyout (E108 / E109, 10-500)
// ---------------------------------------------------------------------------

function ZoomColumn(props: {
  tokens: StatusThemeTokens;
  zoomPercent: number;
  onSetZoom: (percent: number) => void;
  onResetZoom: () => void;
  onZoomDragStart: () => void;
  onZoomDragEnd: () => void;
}): JSX.Element {
  const { tokens, zoomPercent, onSetZoom, onResetZoom, onZoomDragStart, onZoomDragEnd } = props;
  const { t } = useT();
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoomPercent)));

  // Begin a drag on pointer-down and end it on the NEXT pointer-up anywhere —
  // the up can land outside the thumb (fast drags) or the flyout, so it must be
  // a one-shot window listener rather than the slider's own onPointerUp.
  const beginZoomDrag = () => {
    onZoomDragStart();
    const end = () => {
      window.removeEventListener('pointerup', end);
      onZoomDragEnd();
    };
    window.addEventListener('pointerup', end);
  };

  return (
    <Menu positioning="above-end">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-zoom"
            ariaLabel={t('StatusBar_Zoom')}
            title={`${clamped}%`}
          >
            <span data-testid="status-zoom-text">{clamped}%</span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <div
          data-testid="status-zoom-flyout"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px' }}
        >
          <button
            type="button"
            data-testid="status-zoom-out"
            aria-label="Zoom out"
            onClick={() => onSetZoom(Math.max(ZOOM_MIN, clamped - 10))}
            style={zoomButtonStyle(tokens)}
          >
            <StatusGlyph.zoomOut />
          </button>
          <Slider
            data-testid="status-zoom-slider"
            aria-label={t('StatusBar_ZoomLevel')}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            value={clamped}
            onChange={(_, data) => onSetZoom(data.value)}
            onPointerDown={beginZoomDrag}
            style={{ minWidth: 160 }}
          />
          <button
            type="button"
            data-testid="status-zoom-in"
            aria-label="Zoom in"
            onClick={() => onSetZoom(Math.min(ZOOM_MAX, clamped + 10))}
            style={zoomButtonStyle(tokens)}
          >
            <StatusGlyph.zoomIn />
          </button>
          <button
            type="button"
            data-testid="status-zoom-reset"
            aria-label="Restore default zoom"
            onClick={onResetZoom}
            style={{
              border: 'none',
              background: 'transparent',
              color: tokens.text,
              cursor: 'default',
              fontSize: StatusDimensions.fontSize,
              fontFamily: 'Segoe UI, system-ui, sans-serif'
            }}
          >
            {ZOOM_DEFAULT}%
          </button>
        </div>
      </ThemedMenuPopover>
    </Menu>
  );
}

function zoomButtonStyle(tokens: StatusThemeTokens): CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    color: tokens.text,
    cursor: 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  };
}

// ---------------------------------------------------------------------------
//  Column 5 — LineEndingIndicator menu (CRLF / CR / LF)
// ---------------------------------------------------------------------------

function EolColumn(props: {
  tokens: StatusThemeTokens;
  eolId: EolId;
  onChangeEol: (eol: EolId) => void;
}): JSX.Element {
  const { tokens, eolId, onChangeEol } = props;
  const { t } = useT();
  return (
    <Menu positioning="above-end">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-eol"
            ariaLabel={t('StatusBar_LineEnding')}
            title={eolDisplayText(eolId)}
          >
            <span data-testid="status-eol-text">{eolDisplayText(eolId)}</span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList
          data-testid="status-eol-menu"
          style={{ maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', overflowX: 'hidden' }}
        >
          {EOL_MENU_ROWS.map((row) => (
            <MenuItem
              key={row.eol}
              data-testid={`status-eol-${row.eol}`}
              onClick={() => onChangeEol(row.eol)}
            >
              {row.text}
            </MenuItem>
          ))}
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Column 6 — EncodingIndicator menu (dynamic Unicode + "More encodings")
// ---------------------------------------------------------------------------

function EncodingColumn(props: {
  tokens: StatusThemeTokens;
  encodingId: EncodingId;
  ansiEncodings: readonly AnsiEncodingEntry[];
  onReopenWithEncoding: (encodingId: EncodingId) => void;
  onSaveWithEncoding: (encodingId: EncodingId) => void;
}): JSX.Element {
  const { tokens, encodingId, ansiEncodings, onReopenWithEncoding, onSaveWithEncoding } = props;
  const { t } = useT();
  const model = buildEncodingMenuModel(ansiEncodings);

  // UWP's flyout has two parent submenus ("Reopen with" / "Save with"), each
  // listing the four Unicode rows inline then a "More encodings" submenu of the
  // ANSI table. We build both from the same model (statusModel.buildEncodingMenuModel).
  const encodingSubmenu = (action: (id: EncodingId) => void, keyPrefix: string): JSX.Element => (
    <MenuList data-testid={`status-encoding-${keyPrefix}`}>
      {model.unicode.map((row) => (
        <MenuItem
          key={row.encodingId}
          data-testid={`status-encoding-${keyPrefix}-${row.encodingId}`}
          onClick={() => action(row.encodingId)}
        >
          {row.label}
        </MenuItem>
      ))}
      <MenuDivider />
      <Menu positioning="above-end">
        <MenuTrigger disableButtonEnhancement>
          <MenuItem data-testid={`status-encoding-${keyPrefix}-more`}>
            {t('TextEditor_EncodingIndicator_FlyoutItem_MoreEncodings')}
          </MenuItem>
        </MenuTrigger>
        <ThemedMenuPopover>
          <MenuList
            data-testid={`status-encoding-${keyPrefix}-more-list`}
            // The ANSI table is long (dozens of code pages); cap the list height and
            // scroll it (Fluent MenuList does not auto-scroll). Viewport-relative so
            // it stays usable in a short window. The app's overlay scrollbar styling
            // (chrome.css) applies automatically.
            style={{ maxHeight: '50vh', overflowY: 'auto', overflowX: 'hidden' }}
          >
            {model.more.map((row) => (
              <MenuItem
                key={row.encodingId}
                data-testid={`status-encoding-${keyPrefix}-more-${row.encodingId}`}
                onClick={() => action(row.encodingId)}
              >
                {row.label}
              </MenuItem>
            ))}
          </MenuList>
        </ThemedMenuPopover>
      </Menu>
    </MenuList>
  );

  return (
    <Menu positioning="above-end">
      <MenuTrigger disableButtonEnhancement>
        <div>
          <Cell
            tokens={tokens}
            testid="status-encoding"
            ariaLabel={t('StatusBar_Encoding')}
            title={encodingId}
          >
            <span data-testid="status-encoding-text">{encodingId}</span>
          </Cell>
        </div>
      </MenuTrigger>
      <ThemedMenuPopover>
        <MenuList
          data-testid="status-encoding-menu"
          style={{ maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', overflowX: 'hidden' }}
        >
          <Menu positioning="above-end">
            <MenuTrigger disableButtonEnhancement>
              <MenuItem data-testid="status-encoding-reopen">
                {t('TextEditor_EncodingIndicator_FlyoutItem_ReopenWithEncoding')}
              </MenuItem>
            </MenuTrigger>
            <ThemedMenuPopover>{encodingSubmenu(onReopenWithEncoding, 'reopen')}</ThemedMenuPopover>
          </Menu>
          <Menu positioning="above-end">
            <MenuTrigger disableButtonEnhancement>
              <MenuItem data-testid="status-encoding-save">
                {t('TextEditor_EncodingIndicator_FlyoutItem_SaveWithEncoding')}
              </MenuItem>
            </MenuTrigger>
            <ThemedMenuPopover>{encodingSubmenu(onSaveWithEncoding, 'save')}</ThemedMenuPopover>
          </Menu>
        </MenuList>
      </ThemedMenuPopover>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
//  Folder indicator — shows the open folder basename; click to toggle sidebar
// ---------------------------------------------------------------------------

function FolderColumn(props: {
  tokens: StatusThemeTokens;
  folderPath: string | null;
  onToggleFolder: () => void;
}): JSX.Element {
  const { tokens, folderPath, onToggleFolder } = props;
  const { t } = useT();
  if (!folderPath) return <div data-testid="status-folder" />;
  return (
    <Cell
      tokens={tokens}
      testid="status-folder"
      ariaLabel={t('StatusBar_Folder')}
      title={folderPath}
      onClick={onToggleFolder}
    >
      <Glyph icon={StatusGlyph.openFolder} />
      <span
        data-testid="status-folder-text"
        style={{ marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}
      >
        {getFolderBasename(folderPath)}
      </span>
    </Cell>
  );
}

// ---------------------------------------------------------------------------
//  Column 7 — ShadowWindowIndicator (E737)
// ---------------------------------------------------------------------------

function ShadowWindowColumn(props: {
  tokens: StatusThemeTokens;
  isShadowWindow: boolean;
}): JSX.Element | null {
  const { tokens, isShadowWindow } = props;
  const { t } = useT();
  if (!isShadowWindow) return <div data-testid="status-shadow" />;
  return (
    <Cell
      tokens={tokens}
      testid="status-shadow"
      static
      title={t('StatusBar_ShadowWindowHint')}
      padLeft={StatusDimensions.shadowPad}
    >
      <Glyph icon={StatusGlyph.shadowWindow} color={tokens.text} />
    </Cell>
  );
}

// ---------------------------------------------------------------------------
//  StatusBar — the 8-column grid
// ---------------------------------------------------------------------------

export function StatusBar(props: StatusBarProps): JSX.Element {
  const tokens = tokensForStatusTheme(props.theme);

  return (
    <StatusRevealThemeContext.Provider value={props.theme}>
      <div
        data-testid="status-bar"
        data-theme={props.theme}
        role="status"
        style={{
          display: 'grid',
          // Auto / * / Auto x8 — UWP columns + ViewMode + Folder columns.
          gridTemplateColumns: 'auto 1fr auto auto auto auto auto auto auto auto',
          alignItems: 'stretch',
          height: StatusDimensions.height,
          minHeight: StatusDimensions.height,
          background: tokens.background,
          borderTop: `1px solid ${tokens.topBorder}`,
          color: tokens.text,
          overflow: 'hidden'
        }}
      >
        <FolderColumn
          tokens={tokens}
          folderPath={props.folderPath}
          onToggleFolder={props.onToggleFolder}
        />
        <ModificationStateColumn
          tokens={tokens}
          state={props.fileModificationState}
          onReloadFromDisk={props.onReloadFromDisk}
        />
        <PathColumn
          tokens={tokens}
          filePath={props.filePath}
          placeholder={props.fileNamePlaceholder}
          onReloadFromDisk={props.onReloadFromDisk}
          onCopyFullPath={props.onCopyFullPath}
          onOpenContainingFolder={props.onOpenContainingFolder}
          onRename={props.onRename}
        />
        <ModificationColumn
          tokens={tokens}
          isModified={props.isModified}
          onPreviewChanges={props.onPreviewChanges}
          onRevertAllChanges={props.onRevertAllChanges}
        />
        <ViewModeColumn
          tokens={tokens}
          viewMode={props.viewMode}
          onSetViewMode={props.onSetViewMode}
        />
        <LineColumnColumn
          tokens={tokens}
          lineColumn={props.lineColumn}
          onGoToLine={props.onGoToLine}
        />
        <ZoomColumn
          tokens={tokens}
          zoomPercent={props.zoomPercent}
          onSetZoom={props.onSetZoom}
          onResetZoom={props.onResetZoom}
          onZoomDragStart={props.onZoomDragStart}
          onZoomDragEnd={props.onZoomDragEnd}
        />
        <EolColumn tokens={tokens} eolId={props.eolId} onChangeEol={props.onChangeEol} />
        <EncodingColumn
          tokens={tokens}
          encodingId={props.encodingId}
          ansiEncodings={props.ansiEncodings}
          onReopenWithEncoding={props.onReopenWithEncoding}
          onSaveWithEncoding={props.onSaveWithEncoding}
        />
        <ShadowWindowColumn tokens={tokens} isShadowWindow={props.isShadowWindow} />
      </div>
    </StatusRevealThemeContext.Provider>
  );
}
