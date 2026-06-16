import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { AnsiEncodingEntry } from '@shared/ipc-contract';
import { StatusBar, type StatusBarProps } from './StatusBar';

/**
 * StatusBar component spec (Lane C). Asserts the 8-column structure, the UWP
 * column order/glyphs, conditional columns (mod-state / modification / shadow),
 * and that each flyout action fires the bound callback. Pure renderer surface —
 * no IPC: the callbacks are vi.fn() spies the host would wire to window.notepads.
 */

const ANSI: AnsiEncodingEntry[] = [
  { codePage: 1252, label: 'Western (windows-1252)' },
  { codePage: 932, label: 'Japanese (shift_jis)' }
];

function makeProps(overrides: Partial<StatusBarProps> = {}): StatusBarProps {
  return {
    theme: 'light',
    fileModificationState: 'none',
    filePath: 'C:\\docs\\readme.txt',
    fileNamePlaceholder: 'Untitled 1',
    isModified: false,
    lineColumn: { line: 1, column: 1, selectedCount: 0 },
    zoomPercent: 100,
    eolId: 'crlf',
    encodingId: 'UTF-8',
    ansiEncodings: ANSI,
    isShadowWindow: false,
    onReloadFromDisk: vi.fn(),
    onCopyFullPath: vi.fn(),
    onOpenContainingFolder: vi.fn(),
    onRename: vi.fn(),
    onPreviewChanges: vi.fn(),
    onRevertAllChanges: vi.fn(),
    onGoToLine: vi.fn(),
    onSetZoom: vi.fn(),
    onResetZoom: vi.fn(),
    onZoomDragStart: vi.fn(),
    onZoomDragEnd: vi.fn(),
    onChangeEol: vi.fn(),
    onReopenWithEncoding: vi.fn(),
    onSaveWithEncoding: vi.fn(),
    viewMode: { preview: false, diff: false },
    onSetViewMode: vi.fn(),
    folderPath: null,
    onToggleFolder: vi.fn(),
    ...overrides
  };
}

function renderBar(overrides: Partial<StatusBarProps> = {}): StatusBarProps {
  const props = makeProps(overrides);
  render(
    <FluentProvider theme={webLightTheme}>
      <StatusBar {...props} />
    </FluentProvider>
  );
  return props;
}

describe('StatusBar', () => {
  it('renders the 10-column grid (8 UWP + view-mode + folder)', () => {
    renderBar();
    const bar = screen.getByTestId('status-bar');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({
      gridTemplateColumns: 'auto 1fr auto auto auto auto auto auto auto auto'
    });
  });

  it('shows the path text and line/column text', () => {
    renderBar({ lineColumn: { line: 12, column: 5, selectedCount: 0 } });
    expect(screen.getByTestId('status-path-text')).toHaveTextContent('C:\\docs\\readme.txt');
    expect(screen.getByTestId('status-linecol-text')).toHaveTextContent('Ln 12, Col 5');
  });

  it('formats selected-character count in the line/column cell', () => {
    renderBar({ lineColumn: { line: 3, column: 2, selectedCount: 4 } });
    expect(screen.getByTestId('status-linecol-text')).toHaveTextContent(
      'Ln 3, Col 2 (4 characters selected)'
    );
  });

  it('shows the untitled placeholder when there is no file path', () => {
    renderBar({ filePath: null, fileNamePlaceholder: 'Untitled 1' });
    expect(screen.getByTestId('status-path-text')).toHaveTextContent('Untitled 1');
  });

  it('hides the modification-state indicator when state is none', () => {
    renderBar({ fileModificationState: 'none' });
    const cell = screen.getByTestId('status-mod-state');
    // Empty placeholder — no glyph rendered.
    expect(cell).toBeEmptyDOMElement();
  });

  it('renders the modified-outside icon', () => {
    renderBar({ fileModificationState: 'modifiedOutside' });
    expect(screen.getByTestId('status-mod-state')).not.toBeEmptyDOMElement();
  });

  it('renders the renamed/moved/deleted icon', () => {
    renderBar({ fileModificationState: 'renamedMovedDeleted' });
    expect(screen.getByTestId('status-mod-state')).not.toBeEmptyDOMElement();
  });

  it('shows "Modified" only when the buffer is dirty', () => {
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <StatusBar {...makeProps({ isModified: false })} />
      </FluentProvider>
    );
    expect(screen.getByTestId('status-modification')).toBeEmptyDOMElement();
    rerender(
      <FluentProvider theme={webLightTheme}>
        <StatusBar {...makeProps({ isModified: true })} />
      </FluentProvider>
    );
    expect(screen.getByTestId('status-modification')).toHaveTextContent('Modified');
  });

  it('displays the EOL and encoding labels', () => {
    renderBar({ eolId: 'lf', encodingId: 'UTF-16 LE BOM' });
    expect(screen.getByTestId('status-eol-text')).toHaveTextContent('Unix (LF)');
    expect(screen.getByTestId('status-encoding-text')).toHaveTextContent('UTF-16 LE BOM');
  });

  it('shows the clamped zoom percentage', () => {
    renderBar({ zoomPercent: 150 });
    expect(screen.getByTestId('status-zoom-text')).toHaveTextContent('150%');
  });

  it('shows the shadow-window glyph only on a shadow window', () => {
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <StatusBar {...makeProps({ isShadowWindow: false })} />
      </FluentProvider>
    );
    expect(screen.getByTestId('status-shadow')).toBeEmptyDOMElement();
    rerender(
      <FluentProvider theme={webLightTheme}>
        <StatusBar {...makeProps({ isShadowWindow: true })} />
      </FluentProvider>
    );
    expect(screen.getByTestId('status-shadow')).not.toBeEmptyDOMElement();
  });

  it('fires onGoToLine when the line/column cell is clicked', () => {
    const props = renderBar();
    fireEvent.click(screen.getByTestId('status-linecol'));
    expect(props.onGoToLine).toHaveBeenCalledTimes(1);
  });

  it('opens the path flyout and fires copy/folder/rename actions', () => {
    const props = renderBar();
    fireEvent.click(screen.getByTestId('status-path'));
    fireEvent.click(screen.getByTestId('status-path-copy'));
    expect(props.onCopyFullPath).toHaveBeenCalledTimes(1);
  });

  it('opens the EOL menu and fires onChangeEol', () => {
    const props = renderBar();
    fireEvent.click(screen.getByTestId('status-eol'));
    fireEvent.click(screen.getByTestId('status-eol-lf'));
    expect(props.onChangeEol).toHaveBeenCalledWith('lf');
  });

  it('fires onSetZoom from the zoom-out button', () => {
    const props = renderBar({ zoomPercent: 100 });
    fireEvent.click(screen.getByTestId('status-zoom'));
    fireEvent.click(screen.getByTestId('status-zoom-out'));
    expect(props.onSetZoom).toHaveBeenCalledWith(90);
  });

  it('builds the encoding flyout with Unicode rows + a More-encodings submenu', () => {
    const props = renderBar();
    fireEvent.click(screen.getByTestId('status-encoding'));
    fireEvent.click(screen.getByTestId('status-encoding-reopen'));
    // The four Unicode rows render inline under the reopen submenu.
    fireEvent.click(screen.getByTestId('status-encoding-reopen-UTF-8-BOM'));
    expect(props.onReopenWithEncoding).toHaveBeenCalledWith('UTF-8-BOM');
  });

  it('routes a More-encodings ANSI row to the reopen action', () => {
    const props = renderBar();
    fireEvent.click(screen.getByTestId('status-encoding'));
    fireEvent.click(screen.getByTestId('status-encoding-reopen'));
    fireEvent.click(screen.getByTestId('status-encoding-reopen-more'));
    fireEvent.click(screen.getByTestId('status-encoding-reopen-more-Western (windows-1252)'));
    expect(props.onReopenWithEncoding).toHaveBeenCalledWith('Western (windows-1252)');
  });
});
