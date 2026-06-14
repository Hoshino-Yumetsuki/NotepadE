import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewModeKeyboard } from './useViewModeKeyboard';
import { viewModeCallbacksRef } from '../editor/commands/viewModeBridge';

afterEach(() => {
  vi.restoreAllMocks();
  viewModeCallbacksRef.current = null;
});

function dispatchKey(code: string, opts: Partial<KeyboardEventInit> = {}): boolean {
  const e = new KeyboardEvent('keydown', {
    code,
    altKey: true,
    bubbles: true,
    cancelable: true,
    ...opts
  });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('useViewModeKeyboard', () => {
  it('Alt+P toggles preview and prevents default when eligible', () => {
    const togglePreview = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff: vi.fn()
      })
    );
    const prevented = dispatchKey('KeyP');
    expect(togglePreview).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('Alt+P is ignored when not preview-eligible', () => {
    const togglePreview = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => false,
        togglePreview,
        toggleDiff: vi.fn()
      })
    );
    const prevented = dispatchKey('KeyP');
    expect(togglePreview).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('Alt+D toggles diff and prevents default', () => {
    const toggleDiff = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview: vi.fn(),
        toggleDiff
      })
    );
    const prevented = dispatchKey('KeyD');
    expect(toggleDiff).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('ignores Ctrl+Alt+P / Meta+Alt+D', () => {
    const togglePreview = vi.fn();
    const toggleDiff = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff
      })
    );
    dispatchKey('KeyP', { ctrlKey: true });
    dispatchKey('KeyD', { metaKey: true });
    expect(togglePreview).not.toHaveBeenCalled();
    expect(toggleDiff).not.toHaveBeenCalled();
  });

  it('removes listeners on unmount', () => {
    const togglePreview = vi.fn();
    const { unmount } = renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff: vi.fn()
      })
    );
    unmount();
    dispatchKey('KeyP');
    expect(togglePreview).not.toHaveBeenCalled();
  });

  it('writes callbacks into shared ref for CM6 belt-and-suspenders', () => {
    const togglePreview = vi.fn();
    const toggleDiff = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => false,
        togglePreview,
        toggleDiff
      })
    );
    expect(viewModeCallbacksRef.current).toBeDefined();
    expect(viewModeCallbacksRef.current!.isPreviewEligible()).toBe(false);
    viewModeCallbacksRef.current!.togglePreview();
    expect(togglePreview).toHaveBeenCalledTimes(1);
  });
});
