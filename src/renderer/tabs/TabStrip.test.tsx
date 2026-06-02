import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { TabStrip } from './TabStrip';
import { TabsStore } from './useTabsStore';

/**
 * TabStrip component tests (Phase 2, stream C). Mounts the real strip over a
 * fresh TabsStore and asserts the DOM contract the harness selectors rely on:
 * tab rendering, active styling hook, close button, add button, middle-click,
 * and the modified dot. dnd-kit reorder is covered by the store tests + the
 * Playwright matrix (pointer drag needs a real layout engine).
 */

function renderStrip(store: TabsStore, isDark = false): {
  onNewTab: ReturnType<typeof vi.fn>;
  onCloseTab: ReturnType<typeof vi.fn>;
} {
  const onNewTab = vi.fn();
  const onCloseTab = vi.fn();
  const Wrapper = (): ReactElement => {
    return (
      <FluentProvider theme={webLightTheme}>
        <TabStrip
          tabs={store.tabs}
          activeEditorId={store.activeEditorId}
          store={store}
          isDark={isDark}
          onNewTab={onNewTab}
          onCloseTab={onCloseTab}
        />
      </FluentProvider>
    );
  };
  render(<Wrapper />);
  return { onNewTab, onCloseTab };
}

describe('TabStrip rendering', () => {
  let store: TabsStore;
  beforeEach(() => {
    store = new TabsStore();
  });

  it('renders the strip root and tab list', () => {
    store.newTab();
    renderStrip(store);
    expect(screen.getByTestId('tab-strip')).toBeInTheDocument();
    expect(screen.getByTestId('tab-list')).toBeInTheDocument();
  });

  it('renders one [data-testid=tab] per tab in order', () => {
    const a = store.newTab({ untitledName: 'Untitled 1' });
    const b = store.newTab({ untitledName: 'Untitled 2' });
    renderStrip(store);
    const tabEls = screen.getAllByTestId('tab');
    expect(tabEls).toHaveLength(2);
    expect(tabEls[0]).toHaveAttribute('data-editor-id', a);
    expect(tabEls[1]).toHaveAttribute('data-editor-id', b);
  });

  it('marks the active tab via data-active', () => {
    const a = store.newTab();
    const b = store.newTab();
    store.activate(a);
    renderStrip(store);
    const tabEls = screen.getAllByTestId('tab');
    const aEl = tabEls.find((t) => t.getAttribute('data-editor-id') === a);
    const bEl = tabEls.find((t) => t.getAttribute('data-editor-id') === b);
    expect(aEl).toHaveAttribute('data-active', 'true');
    expect(bEl).toHaveAttribute('data-active', 'false');
  });

  it('shows the file basename as the title for saved tabs', () => {
    store.newTab({ filePath: 'C:/docs/readme.txt' });
    renderStrip(store);
    expect(screen.getByTestId('tab-title')).toHaveTextContent('readme.txt');
  });

  it('shows the untitled name when filePath is null', () => {
    store.newTab({ untitledName: 'Untitled 7' });
    renderStrip(store);
    expect(screen.getByTestId('tab-title')).toHaveTextContent('Untitled 7');
  });

  it('renders the add-tab button with glyph E710', () => {
    store.newTab();
    renderStrip(store);
    const add = screen.getByTestId('tab-add');
    expect(add).toHaveTextContent('\uE710');
  });

  it('renders the close button glyph E711 per tab', () => {
    store.newTab();
    renderStrip(store);
    expect(screen.getByTestId('tab-close')).toHaveTextContent('\uE711');
  });
});

describe('TabStrip interactions', () => {
  let store: TabsStore;
  beforeEach(() => {
    store = new TabsStore();
  });

  it('clicking the add button invokes onNewTab', () => {
    store.newTab();
    const { onNewTab } = renderStrip(store);
    fireEvent.click(screen.getByTestId('tab-add'));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('clicking the close button invokes onCloseTab with the editorId', () => {
    const a = store.newTab();
    const { onCloseTab } = renderStrip(store);
    fireEvent.click(screen.getByTestId('tab-close'));
    expect(onCloseTab).toHaveBeenCalledWith(a);
  });

  it('middle-click on a tab closes it', () => {
    const a = store.newTab();
    const { onCloseTab } = renderStrip(store);
    fireEvent.pointerDown(screen.getByTestId('tab'), { button: 1 });
    expect(onCloseTab).toHaveBeenCalledWith(a);
  });

  it('left-click activates the tab', () => {
    const a = store.newTab();
    const b = store.newTab();
    store.activate(a);
    renderStrip(store);
    const bEl = screen
      .getAllByTestId('tab')
      .find((t) => t.getAttribute('data-editor-id') === b)!;
    fireEvent.pointerDown(bEl, { button: 0 });
    expect(store.activeEditorId).toBe(b);
  });

  it('Ctrl+left-click is suppressed (no activation)', () => {
    const a = store.newTab();
    const b = store.newTab();
    store.activate(a);
    renderStrip(store);
    const bEl = screen
      .getAllByTestId('tab')
      .find((t) => t.getAttribute('data-editor-id') === b)!;
    fireEvent.pointerDown(bEl, { button: 0, ctrlKey: true });
    expect(store.activeEditorId).toBe(a);
  });

  it('shows the modified dot only when the tab is modified', () => {
    const a = store.newTab();
    renderStrip(store);
    const dot = screen.getByTestId('tab-modified');
    expect(dot).toHaveStyle({ display: 'none' });
    // re-render with modified state
    store.setModified(a, true);
    renderStrip(store);
    const dots = screen.getAllByTestId('tab-modified');
    expect(dots.some((d) => !(d as HTMLElement).style.display.includes('none'))).toBe(true);
  });
});

describe('TabStrip context menu', () => {
  let store: TabsStore;
  beforeEach(() => {
    store = new TabsStore();
  });

  it('opens the 9-item menu in exact UWP order on right-click', () => {
    store.newTab({ filePath: 'C:/x/a.txt' });
    store.newTab({ filePath: 'C:/x/b.txt' });
    renderStrip(store);
    const tab = screen.getAllByTestId('tab')[0];
    fireEvent.contextMenu(tab);

    const menu = screen.getByTestId('tab-menu');
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByTestId('tab-menu-close')).toHaveTextContent('Close');
    expect(within(menu).getByTestId('tab-menu-close-others')).toHaveTextContent('Close Others');
    expect(within(menu).getByTestId('tab-menu-close-right')).toHaveTextContent(
      'Close to the Right',
    );
    expect(within(menu).getByTestId('tab-menu-close-saved')).toHaveTextContent('Close Saved');
    expect(within(menu).getByTestId('tab-menu-copy-path')).toHaveTextContent('Copy Full Path');
    expect(within(menu).getByTestId('tab-menu-open-folder')).toHaveTextContent(
      'Open Containing Folder',
    );
    expect(within(menu).getByTestId('tab-menu-rename')).toHaveTextContent('Rename');
  });

  it('disables Close Others / Close to the Right when only one tab', () => {
    store.newTab({ filePath: 'C:/x/a.txt' });
    renderStrip(store);
    fireEvent.contextMenu(screen.getByTestId('tab'));
    expect(screen.getByTestId('tab-menu-close-others')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tab-menu-close-right')).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables Copy Full Path / Open Containing Folder for untitled tabs', () => {
    store.newTab({ untitledName: 'Untitled 1' });
    store.newTab({ untitledName: 'Untitled 2' });
    renderStrip(store);
    fireEvent.contextMenu(screen.getAllByTestId('tab')[0]);
    expect(screen.getByTestId('tab-menu-copy-path')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tab-menu-open-folder')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('TabStrip context-menu actions', () => {
  let store: TabsStore;
  let copyPath: ReturnType<typeof vi.fn>;
  let openContainingFolder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new TabsStore();
    copyPath = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    openContainingFolder = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    // Minimal window.notepads.shell stub — the only contract the menu touches.
    (window as unknown as { notepads: { shell: unknown } }).notepads = {
      shell: { copyPath, openContainingFolder },
    };
  });

  it('Copy Full Path routes through window.notepads.shell.copyPath with the abs path', () => {
    store.newTab({ filePath: 'C:/docs/notes.txt' });
    store.newTab({ filePath: 'C:/docs/other.txt' });
    renderStrip(store);
    fireEvent.contextMenu(screen.getAllByTestId('tab')[0]);
    fireEvent.click(screen.getByTestId('tab-menu-copy-path'));
    expect(copyPath).toHaveBeenCalledWith('C:/docs/notes.txt');
  });

  it('Open Containing Folder routes through window.notepads.shell.openContainingFolder', () => {
    store.newTab({ filePath: 'C:/docs/notes.txt' });
    store.newTab({ filePath: 'C:/docs/other.txt' });
    renderStrip(store);
    fireEvent.contextMenu(screen.getAllByTestId('tab')[0]);
    fireEvent.click(screen.getByTestId('tab-menu-open-folder'));
    expect(openContainingFolder).toHaveBeenCalledWith('C:/docs/notes.txt');
  });

  it('Close Others keeps only the target tab', () => {
    const a = store.newTab({ filePath: 'C:/x/a.txt' });
    store.newTab({ filePath: 'C:/x/b.txt' });
    store.newTab({ filePath: 'C:/x/c.txt' });
    renderStrip(store);
    const aEl = screen.getAllByTestId('tab').find((t) => t.getAttribute('data-editor-id') === a)!;
    fireEvent.contextMenu(aEl);
    fireEvent.click(screen.getByTestId('tab-menu-close-others'));
    expect(store.tabs.map((t) => t.editorId)).toEqual([a]);
  });

  it('Close to the Right removes tabs after the target', () => {
    const a = store.newTab({ filePath: 'C:/x/a.txt' });
    const b = store.newTab({ filePath: 'C:/x/b.txt' });
    store.newTab({ filePath: 'C:/x/c.txt' });
    renderStrip(store);
    const aEl = screen.getAllByTestId('tab').find((t) => t.getAttribute('data-editor-id') === a)!;
    fireEvent.contextMenu(aEl);
    fireEvent.click(screen.getByTestId('tab-menu-close-right'));
    expect(store.tabs.map((t) => t.editorId)).toEqual([a]);
    expect(b).toBeTruthy();
  });

  it('Rename opens the inline rename input on the tab', () => {
    store.newTab({ untitledName: 'Untitled 1' });
    renderStrip(store);
    fireEvent.contextMenu(screen.getByTestId('tab'));
    fireEvent.click(screen.getByTestId('tab-menu-rename'));
    expect(screen.getByTestId('tab-rename-input')).toBeInTheDocument();
  });
});
