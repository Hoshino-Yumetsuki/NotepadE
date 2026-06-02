import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { TabsStore } from './useTabsStore';
import { useTabKeyboard } from './useTabKeyboard';

/**
 * Window-level tab keyboard shortcuts (Phase 2, task #1e). Asserts the keymap
 * routes Ctrl+N/T/W, Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+1-9, and F2 to the right
 * store actions / callbacks, mirroring NotepadsMainPage.xaml.cs accelerators.
 */
function press(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('useTabKeyboard', () => {
  let store: TabsStore;
  let onNewTab: ReturnType<typeof vi.fn>;
  let onRename: ReturnType<typeof vi.fn>;
  let a: string;
  let b: string;
  let c: string;

  beforeEach(() => {
    store = new TabsStore();
    a = store.newTab();
    b = store.newTab();
    c = store.newTab();
    onNewTab = vi.fn();
    onRename = vi.fn();
    renderHook(() => useTabKeyboard(store, { onNewTab, onRename }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Ctrl+N invokes onNewTab', () => {
    press({ key: 'n', ctrlKey: true, code: 'KeyN' });
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+T invokes onNewTab', () => {
    press({ key: 't', ctrlKey: true, code: 'KeyT' });
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+W closes the active tab', () => {
    store.activate(b);
    press({ key: 'w', ctrlKey: true, code: 'KeyW' });
    expect(store.indexOf(b)).toBe(-1);
    expect(store.activeEditorId).toBe(c);
  });

  it('Ctrl+Tab activates the next tab', () => {
    store.activate(a);
    press({ key: 'Tab', ctrlKey: true, code: 'Tab' });
    expect(store.activeEditorId).toBe(b);
  });

  it('Ctrl+Shift+Tab activates the previous tab', () => {
    store.activate(a);
    press({ key: 'Tab', ctrlKey: true, shiftKey: true, code: 'Tab' });
    expect(store.activeEditorId).toBe(c);
  });

  it('Ctrl+1 jumps to the first tab', () => {
    store.activate(c);
    press({ key: '1', ctrlKey: true, code: 'Digit1' });
    expect(store.activeEditorId).toBe(a);
  });

  it('Ctrl+2 jumps to the second tab', () => {
    press({ key: '2', ctrlKey: true, code: 'Digit2' });
    expect(store.activeEditorId).toBe(b);
  });

  it('Ctrl+9 jumps to the LAST tab', () => {
    store.activate(a);
    press({ key: '9', ctrlKey: true, code: 'Digit9' });
    expect(store.activeEditorId).toBe(c);
  });

  it('F2 invokes onRename with the active editorId', () => {
    store.activate(b);
    press({ key: 'F2', code: 'F2' });
    expect(onRename).toHaveBeenCalledWith(b);
  });

  it('ignores Ctrl+Shift+N (app-level new instance, not a tab shortcut)', () => {
    press({ key: 'N', ctrlKey: true, shiftKey: true, code: 'KeyN' });
    expect(onNewTab).not.toHaveBeenCalled();
  });

  it('onCloseActive override is used when provided', () => {
    // Fresh store + lone hook so the beforeEach handler doesn't also fire.
    const isolated = new TabsStore();
    const x = isolated.newTab();
    const y = isolated.newTab();
    const onCloseActive = vi.fn();
    renderHook(() => useTabKeyboard(isolated, { onNewTab, onRename, onCloseActive }));
    isolated.activate(y);
    press({ key: 'w', ctrlKey: true, code: 'KeyW' });
    expect(onCloseActive).toHaveBeenCalledWith(y);
    // The default store.close path was NOT taken (override wins).
    expect(isolated.indexOf(y)).not.toBe(-1);
    expect(isolated.indexOf(x)).not.toBe(-1);
  });
});
