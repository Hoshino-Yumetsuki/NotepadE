/**
 * Unit tests for useSettings (Phase 5, Stream C).
 *
 * Asserts the hook's three contracts against a mocked window.notepads.settings:
 *   - initial get() hydrates the bag,
 *   - update() optimistically applies + persists via set(),
 *   - onChanged broadcasts (external writes) reconcile into state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import type { Settings } from '@shared/ipc-contract';
import { useSettings } from './useSettings';

let changedCb: ((s: Settings) => void) | null = null;

function installMock(initial: Partial<Settings> = {}): { set: ReturnType<typeof vi.fn> } {
  const bag = { ...DEFAULT_SETTINGS, ...initial };
  const set = vi.fn(async (patch: Partial<Settings>) => ({
    ok: true as const,
    data: { ...bag, ...patch },
  }));
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: bag })),
      set,
      onChanged: (cb: (s: Settings) => void) => {
        changedCb = cb;
        return () => {
          changedCb = null;
        };
      },
    },
  } as unknown as typeof window.notepads;
  return { set };
}

describe('useSettings', () => {
  beforeEach(() => {
    changedCb = null;
  });

  it('hydrates from settings.get()', async () => {
    installMock({ showStatusBar: false });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.settings.showStatusBar).toBe(false));
  });

  it('optimistically applies + persists via settings.set()', async () => {
    const { set } = installMock();
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.settings).toBeDefined());
    act(() => result.current.update({ tintOpacity: 0.5 }));
    expect(result.current.settings.tintOpacity).toBe(0.5); // optimistic
    expect(set).toHaveBeenCalledWith({ tintOpacity: 0.5 });
  });

  it('reconciles external broadcasts via onChanged', async () => {
    installMock({ themeMode: 'light' });
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.settings.themeMode).toBe('light'));
    act(() => changedCb?.({ ...DEFAULT_SETTINGS, themeMode: 'dark' }));
    await waitFor(() => expect(result.current.settings.themeMode).toBe('dark'));
  });
});
