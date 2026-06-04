import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewModeKeyboard } from './useViewModeKeyboard';

/**
 * View-mode keyboard controller test (Lane B, Phase 6). Asserts Alt+P toggles
 * preview (only when eligible), Alt+D toggles diff, and modifier combos with
 * Ctrl/Meta are ignored so they never collide with editor/find/tab shortcuts.
 */

function dispatchKey(code: string, opts: Partial<KeyboardEventInit> = {}): boolean {
  const e = new KeyboardEvent('keydown', {
    code,
    altKey: true,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useViewModeKeyboard', () => {
  it('Alt+P toggles preview when eligible', () => {
    const togglePreview = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff: vi.fn(),
      }),
    );
    const prevented = dispatchKey('KeyP');
    expect(togglePreview).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('Alt+P is ignored when the tab is not preview-eligible', () => {
    const togglePreview = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => false,
        togglePreview,
        toggleDiff: vi.fn(),
      }),
    );
    const prevented = dispatchKey('KeyP');
    expect(togglePreview).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('Alt+D toggles diff', () => {
    const toggleDiff = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview: vi.fn(),
        toggleDiff,
      }),
    );
    const prevented = dispatchKey('KeyD');
    expect(toggleDiff).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it('ignores Ctrl+Alt+P / Meta+Alt+D (modifier collisions)', () => {
    const togglePreview = vi.fn();
    const toggleDiff = vi.fn();
    renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff,
      }),
    );
    dispatchKey('KeyP', { ctrlKey: true });
    dispatchKey('KeyD', { metaKey: true });
    expect(togglePreview).not.toHaveBeenCalled();
    expect(toggleDiff).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    const togglePreview = vi.fn();
    const { unmount } = renderHook(() =>
      useViewModeKeyboard({
        isPreviewEligible: () => true,
        togglePreview,
        toggleDiff: vi.fn(),
      }),
    );
    unmount();
    dispatchKey('KeyP');
    expect(togglePreview).not.toHaveBeenCalled();
  });
});
