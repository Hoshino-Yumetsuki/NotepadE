import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api';
import { TabsStore } from '../tabs/useTabsStore';
import {
  useStatusBarModel,
  getEditorZoom,
  initEditorZoom,
  applyEditorZoom
} from './useStatusBarModel';
import { DEFAULT_ZOOM, MAX_ZOOM } from '../editor/commands/logic/zoom';

/**
 * Zoom slider ↔ Monaco editor bidirectional sync (UWP FontZoomIndicator/E108 parity).
 *
 * The slider/buttons must drive the same per-editor zoom registry that keyboard
 * commands (T3) use, and a registry change must surface back via the 250ms poll.
 * Tab switches must show the newly-active editor's zoom.
 *
 * Monaco editor instances are mocked (jsdom has no Monaco); only the registry
 * and hook state are exercised.
 */

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as unknown as { window: Window }).window.notepads = {
    encoding: {
      listAnsi: vi.fn(async () => ({ ok: true as const, data: [] }))
    },
    file: {
      revalidatePath: vi.fn(async () => ({
        ok: true as const,
        data: { exists: true, dateModifiedMs: 0 }
      }))
    }
  } as unknown as typeof window.notepads;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Create a minimal mock Monaco editor with a zoom registry entry. */
function makeEditor(baseFontSize = 14): monacoApi.editor.IStandaloneCodeEditor {
  const updateOptions = vi.fn();
  const editor = {
    updateOptions,
    getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    getSelection: vi.fn(() => null),
    getModel: vi.fn(() => null),
    onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() }))
  } as unknown as monacoApi.editor.IStandaloneCodeEditor;
  initEditorZoom(editor, baseFontSize);
  return editor;
}

/** Wrap an editor in the minimal MonacoHandle surface the hook reads. */
function handleFor(editor: monacoApi.editor.IStandaloneCodeEditor) {
  return {
    getEditor: () => editor,
    setDoc: vi.fn(),
    getShadowText: vi.fn(() => ''),
    focus: vi.fn(),
    tryInsertLogEntry: vi.fn(() => false)
  };
}

describe('useStatusBarModel zoom sync (Monaco)', () => {
  it('onSetZoom writes to the zoom registry and calls updateOptions (slider → editor)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const editor = makeEditor(14);
    const handle = handleFor(editor);

    const { result } = renderHook(() =>
      useStatusBarModel({
        theme: 'light',
        store,
        getActiveHandle: () => handle,
        activeEditorId: id
      })
    );

    act(() => {
      result.current.onSetZoom(150);
    });

    // Registry is the single zoom authority.
    expect(getEditorZoom(editor)).toBe(150);
    // updateOptions called with the scaled font size (14 * 150/100 = 21).
    expect(editor.updateOptions).toHaveBeenCalledWith({ fontSize: 21 });
    // Optimistic local mirror updates in the same tick (no 250ms wait).
    expect(result.current.zoomPercent).toBe(150);
  });

  it('onResetZoom restores the editor to 100% (UWP Ctrl+0 default)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const editor = makeEditor(14);
    const handle = handleFor(editor);

    const { result } = renderHook(() =>
      useStatusBarModel({
        theme: 'light',
        store,
        getActiveHandle: () => handle,
        activeEditorId: id
      })
    );

    act(() => { result.current.onSetZoom(250); });
    expect(getEditorZoom(editor)).toBe(250);

    act(() => { result.current.onResetZoom(); });
    expect(getEditorZoom(editor)).toBe(DEFAULT_ZOOM);
    expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);
  });

  it('out-of-range slider value is clamped to MAX_ZOOM', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const editor = makeEditor(14);
    const handle = handleFor(editor);

    const { result } = renderHook(() =>
      useStatusBarModel({
        theme: 'light',
        store,
        getActiveHandle: () => handle,
        activeEditorId: id
      })
    );

    act(() => { result.current.onSetZoom(9999); });
    expect(getEditorZoom(editor)).toBe(MAX_ZOOM);
    expect(result.current.zoomPercent).toBe(MAX_ZOOM);
  });

  it('a registry change by T3 keyboard command surfaces via the 250ms poll (editor → slider)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const editor = makeEditor(14);
    const handle = handleFor(editor);

    const { result } = renderHook(() =>
      useStatusBarModel({
        theme: 'light',
        store,
        getActiveHandle: () => handle,
        activeEditorId: id
      })
    );

    expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);

    // Simulate T3 keyboard zoom writing directly to the registry.
    act(() => {
      applyEditorZoom(editor, 130);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.zoomPercent).toBe(130);
  });

  it('reflects the newly-active editor zoom on tab switch (zoom is per-editor)', () => {
    const store = new TabsStore();
    const idA = store.newTab();
    const idB = store.newTab({ activate: false });
    const editorA = makeEditor(14);
    const editorB = makeEditor(14);
    const handles = new Map([
      [idA, handleFor(editorA)],
      [idB, handleFor(editorB)]
    ]);

    const { result, rerender } = renderHook(
      ({ activeEditorId }: { activeEditorId: string }) =>
        useStatusBarModel({
          theme: 'light',
          store,
          getActiveHandle: () => handles.get(activeEditorId) ?? null,
          activeEditorId
        }),
      { initialProps: { activeEditorId: idA } }
    );

    // Zoom tab A to 200 via the slider; tab B stays at default.
    act(() => { result.current.onSetZoom(200); });
    expect(getEditorZoom(editorA)).toBe(200);
    expect(getEditorZoom(editorB)).toBe(DEFAULT_ZOOM);

    // Switch to B: hook re-fires on activeEditorId and snapshots immediately.
    rerender({ activeEditorId: idB });
    expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);

    // Back to A: per-editor 200% survives the round trip.
    rerender({ activeEditorId: idA });
    expect(result.current.zoomPercent).toBe(200);
  });
});
