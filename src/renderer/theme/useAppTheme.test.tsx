import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import { useAppTheme } from './useAppTheme';

function AccentProbe(): JSX.Element {
  const { accentHex } = useAppTheme();
  return <output data-testid="accent">{accentHex}</output>;
}

describe('useAppTheme', () => {
  let onAccentChanged: ((accent: string) => void) | undefined;

  beforeEach(() => {
    onAccentChanged = undefined;
    const notepads = {
      settings: {
        get: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
        onChanged: () => () => {}
      },
      theme: {
        get: vi.fn(async () => ({
          ok: true as const,
          data: { osTheme: 'light' as const, accentColor: '#123456', highContrast: false }
        })),
        onOsThemeChanged: () => () => {},
        onAccentChanged: (callback: (accent: string) => void) => {
          onAccentChanged = callback;
          return () => {};
        }
      }
    };
    const testWindow = window as unknown as { notepads: typeof notepads };
    testWindow.notepads = notepads;
  });

  afterEach(() => {
    const testWindow = window as unknown as { notepads?: unknown };
    delete testWindow.notepads;
  });

  it('uses Windows blue when Windows reports the black accent sentinel', async () => {
    render(<AccentProbe />);
    await waitFor(() => expect(screen.getByTestId('accent')).toHaveTextContent('#123456'));

    act(() => onAccentChanged?.('#000000'));

    await waitFor(() => expect(screen.getByTestId('accent')).toHaveTextContent('#0078D4'));
  });
});
