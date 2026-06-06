import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import { CloseReminderDialog } from './CloseReminderDialog';
import { I18nProvider } from './i18n';

/**
 * CloseReminderDialog tests (Issue 4, UWP SetCloseSaveReminderDialog parity).
 * Verifies the three outcomes wire to the right callbacks and that the dialog is
 * hidden when nothing is pending. Strings resolve through the real I18nProvider
 * (ported SetCloseSaveReminderDialog_* keys), so the data-testids — not text — are
 * the stable selectors.
 */

// I18nProvider calls window.notepads.settings.get()/onChanged on mount; stub it.
beforeEach(() => {
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      set: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      onChanged: () => () => {},
    },
  } as unknown as typeof window.notepads;
});

function renderDialog(pending: { editorId: string; fileName: string } | null): {
  onSave: ReturnType<typeof vi.fn>;
  onDontSave: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onSave = vi.fn();
  const onDontSave = vi.fn();
  const onCancel = vi.fn();
  const Wrapper = (): ReactElement => (
    <I18nProvider>
      <FluentProvider theme={webLightTheme}>
        <CloseReminderDialog
          pending={pending}
          onSave={onSave}
          onDontSave={onDontSave}
          onCancel={onCancel}
        />
      </FluentProvider>
    </I18nProvider>
  );
  render(<Wrapper />);
  return { onSave, onDontSave, onCancel };
}

describe('CloseReminderDialog', () => {
  it('is hidden when nothing is pending', () => {
    renderDialog(null);
    expect(screen.queryByTestId('close-reminder-dialog')).not.toBeInTheDocument();
  });

  it('shows the dialog for a modified tab and fires Save', () => {
    const { onSave, onDontSave, onCancel } = renderDialog({
      editorId: 'e1',
      fileName: 'notes.txt',
    });
    expect(screen.getByTestId('close-reminder-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('close-reminder-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDontSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("fires Don't Save (discard)", () => {
    const { onSave, onDontSave } = renderDialog({ editorId: 'e1', fileName: 'notes.txt' });
    fireEvent.click(screen.getByTestId('close-reminder-dontsave'));
    expect(onDontSave).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('fires Cancel (keep the tab)', () => {
    const { onCancel, onSave, onDontSave } = renderDialog({
      editorId: 'e1',
      fileName: 'notes.txt',
    });
    fireEvent.click(screen.getByTestId('close-reminder-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onDontSave).not.toHaveBeenCalled();
  });
});
