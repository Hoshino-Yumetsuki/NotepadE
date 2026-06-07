import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import { AppCloseReminderDialog } from './AppCloseReminderDialog';
import { I18nProvider } from './i18n';

/**
 * AppCloseReminderDialog tests (W1, UWP AppCloseSaveReminderDialog parity). Three
 * outcomes wire to the right callbacks; hidden when closed. data-testids are the
 * stable selectors (strings resolve through the real I18nProvider).
 */

beforeEach(() => {
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      set: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      onChanged: () => () => {},
    },
  } as unknown as typeof window.notepads;
});

function renderDialog(open: boolean): {
  onSaveAllAndExit: ReturnType<typeof vi.fn>;
  onDiscardAndExit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onSaveAllAndExit = vi.fn();
  const onDiscardAndExit = vi.fn();
  const onCancel = vi.fn();
  const Wrapper = (): ReactElement => (
    <I18nProvider>
      <FluentProvider theme={webLightTheme}>
        <AppCloseReminderDialog
          open={open}
          onSaveAllAndExit={onSaveAllAndExit}
          onDiscardAndExit={onDiscardAndExit}
          onCancel={onCancel}
        />
      </FluentProvider>
    </I18nProvider>
  );
  render(<Wrapper />);
  return { onSaveAllAndExit, onDiscardAndExit, onCancel };
}

describe('AppCloseReminderDialog', () => {
  it('is hidden when closed', () => {
    renderDialog(false);
    expect(screen.queryByTestId('app-close-reminder-dialog')).not.toBeInTheDocument();
  });

  it('fires Save All & Exit', () => {
    const { onSaveAllAndExit, onDiscardAndExit, onCancel } = renderDialog(true);
    expect(screen.getByTestId('app-close-reminder-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('app-close-reminder-saveall'));
    expect(onSaveAllAndExit).toHaveBeenCalledTimes(1);
    expect(onDiscardAndExit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires Discard & Exit', () => {
    const { onDiscardAndExit, onSaveAllAndExit } = renderDialog(true);
    fireEvent.click(screen.getByTestId('app-close-reminder-discard'));
    expect(onDiscardAndExit).toHaveBeenCalledTimes(1);
    expect(onSaveAllAndExit).not.toHaveBeenCalled();
  });

  it('fires Cancel', () => {
    const { onCancel, onSaveAllAndExit, onDiscardAndExit } = renderDialog(true);
    fireEvent.click(screen.getByTestId('app-close-reminder-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSaveAllAndExit).not.toHaveBeenCalled();
    expect(onDiscardAndExit).not.toHaveBeenCalled();
  });
});
