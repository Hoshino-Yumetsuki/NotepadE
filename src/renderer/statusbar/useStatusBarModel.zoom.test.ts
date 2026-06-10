import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { TabsStore } from '../tabs/useTabsStore';
import type { CodeMirrorHandle } from '../editor/CodeMirrorEditor';
import { mountView } from '../editor/commands/testUtils';
import { editorSettings } from '../editor/editorSettings';
import { zoomField, zoomStyle, setZoom, DEFAULT_ZOOM } from '../editor/commands/zoom';
import { useStatusBarModel } from './useStatusBarModel';

/**
 * Zoom slider ↔ editor bidirectional sync (UWP FontZoomIndicator/E108 parity).
 *
 * The slider/buttons must drive the SAME per-editor zoomField the keyboard +
 * Ctrl+wheel commands mutate (one zoom authority), and a field change made by
 * those commands must surface back into the status-bar percent via the 250ms
 * poll — the editor view is owned by CodeMirrorEditor, so the status bar reads
 * the field instead of mounting its own updateListener. Tab switches must show
 * the newly-active editor's (per-state) zoom.
 *
 * Real CM6 views (jsdom) + the real hook; only window.notepads is stubbed
 * (PA-8: the hook touches IPC for the ANSI list / file revalidation only).
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

/** Mount a zoom-capable CM6 view (the field + the style listener, like keymap.ts). */
function zoomView(): EditorView {
  return mountView('hello', EditorSelection.cursor(0), [
    editorSettings.of({}),
    zoomField,
    zoomStyle
  ]);
}

/** Wrap a live view in the minimal CodeMirrorHandle surface the hook reads. */
function handleFor(view: EditorView): CodeMirrorHandle {
  return { getView: () => view } as unknown as CodeMirrorHandle;
}

describe('useStatusBarModel zoom sync', () => {
  it('onSetZoom dispatches setZoom into the ACTIVE editor view (slider → editor)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const view = zoomView();
    try {
      const { result } = renderHook(() =>
        useStatusBarModel({
          theme: 'light',
          store,
          getActiveHandle: () => handleFor(view),
          activeEditorId: id
        })
      );
      act(() => {
        result.current.onSetZoom(150);
      });
      // The field is the single zoom authority — the slider write must land there.
      expect(view.state.field(zoomField)).toBe(150);
      // Optimistic local mirror updates in the same tick (no 250ms wait).
      expect(result.current.zoomPercent).toBe(150);
    } finally {
      view.destroy();
    }
  });

  it('onResetZoom restores the editor field to 100% (UWP Ctrl+0 default)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const view = zoomView();
    try {
      const { result } = renderHook(() =>
        useStatusBarModel({
          theme: 'light',
          store,
          getActiveHandle: () => handleFor(view),
          activeEditorId: id
        })
      );
      act(() => {
        result.current.onSetZoom(250);
      });
      expect(view.state.field(zoomField)).toBe(250);
      act(() => {
        result.current.onResetZoom();
      });
      expect(view.state.field(zoomField)).toBe(DEFAULT_ZOOM);
      expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);
    } finally {
      view.destroy();
    }
  });

  it('an out-of-range slider value settles on the field-clamped percent after the poll', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const view = zoomView();
    try {
      const { result } = renderHook(() =>
        useStatusBarModel({
          theme: 'light',
          store,
          getActiveHandle: () => handleFor(view),
          activeEditorId: id
        })
      );
      act(() => {
        result.current.onSetZoom(9999);
      });
      // The zoomField reducer clamps to MAX_ZOOM (500); the next poll tick
      // re-reads the field and overwrites the optimistic local value.
      expect(view.state.field(zoomField)).toBe(500);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(result.current.zoomPercent).toBe(500);
    } finally {
      view.destroy();
    }
  });

  it('a setZoom effect dispatched by editor commands reaches zoomPercent (editor → slider)', () => {
    const store = new TabsStore();
    const id = store.newTab();
    const view = zoomView();
    try {
      const { result } = renderHook(() =>
        useStatusBarModel({
          theme: 'light',
          store,
          getActiveHandle: () => handleFor(view),
          activeEditorId: id
        })
      );
      expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);
      // Simulate Ctrl+wheel / Ctrl+± zoom: a setZoom effect straight into the
      // view, bypassing React entirely — exactly what ctrlWheelZoom does.
      act(() => {
        view.dispatch({ effects: setZoom.of(130) });
        vi.advanceTimersByTime(250); // next poll tick mirrors the field
      });
      expect(result.current.zoomPercent).toBe(130);
    } finally {
      view.destroy();
    }
  });

  it('reflects the newly-active editor zoom on tab switch (zoom is per-editor)', () => {
    const store = new TabsStore();
    const idA = store.newTab();
    const idB = store.newTab({ activate: false });
    const viewA = zoomView();
    const viewB = zoomView();
    const handles = new Map<string, CodeMirrorHandle>([
      [idA, handleFor(viewA)],
      [idB, handleFor(viewB)]
    ]);
    try {
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
      // Zoom tab A to 200 via the slider; tab B's field stays at the default.
      act(() => {
        result.current.onSetZoom(200);
      });
      expect(viewA.state.field(zoomField)).toBe(200);
      expect(viewB.state.field(zoomField)).toBe(DEFAULT_ZOOM);
      // Switch to B: the poll effect re-fires on activeEditorId and refreshes
      // immediately, so the slider shows B's zoom without waiting 250ms.
      rerender({ activeEditorId: idB });
      expect(result.current.zoomPercent).toBe(DEFAULT_ZOOM);
      // And back to A: its per-editor 200% survives the round trip.
      rerender({ activeEditorId: idA });
      expect(result.current.zoomPercent).toBe(200);
    } finally {
      viewA.destroy();
      viewB.destroy();
    }
  });
});
