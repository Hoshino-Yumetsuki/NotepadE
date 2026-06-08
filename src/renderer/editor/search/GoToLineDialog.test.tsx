import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import { GoToLineDialog } from './GoToLineDialog';
import { I18nProvider } from '../../i18n';

/**
 * GoToLineDialog tests (W4, UWP GoToControl parity). Validates the numeric input,
 * the out-of-range guard, and that a valid submit reports the line number. Replaces
 * the prior raw window.prompt.
 */

beforeEach(() => {
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      set: vi.fn(async () => ({ ok: true as const, data: DEFAULT_SETTINGS })),
      onChanged: () => () => {}
    }
  } as unknown as typeof window.notepads;
});

function renderDialog(opts: { currentLine?: number; lineCount?: number } = {}): {
  onSubmit: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const Wrapper = (): ReactElement => (
    <I18nProvider>
      <FluentProvider theme={webLightTheme}>
        <GoToLineDialog
          open
          currentLine={opts.currentLine ?? 1}
          lineCount={opts.lineCount ?? 100}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </FluentProvider>
    </I18nProvider>
  );
  render(<Wrapper />);
  return { onSubmit, onCancel };
}

function setInput(value: string): void {
  fireEvent.change(screen.getByTestId('goto-line-input'), { target: { value } });
}

describe('GoToLineDialog', () => {
  it('seeds the input with the current line', () => {
    renderDialog({ currentLine: 42, lineCount: 100 });
    expect(screen.getByTestId('goto-line-input')).toHaveValue('42');
  });

  it('submits a valid in-range line number', () => {
    const { onSubmit } = renderDialog({ lineCount: 100 });
    setInput('57');
    fireEvent.click(screen.getByTestId('goto-line-submit'));
    expect(onSubmit).toHaveBeenCalledWith(57);
  });

  it('rejects non-numeric input (no submit)', () => {
    const { onSubmit } = renderDialog({ lineCount: 100 });
    setInput('abc');
    fireEvent.click(screen.getByTestId('goto-line-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('You can only type a number!')).toBeInTheDocument();
  });

  it('rejects an out-of-range line (no submit)', () => {
    const { onSubmit } = renderDialog({ lineCount: 10 });
    setInput('999');
    fireEvent.click(screen.getByTestId('goto-line-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('Line number exceeds beyond the total number of lines!')
    ).toBeInTheDocument();
  });

  it('submits on Enter', () => {
    const { onSubmit } = renderDialog({ lineCount: 100 });
    setInput('5');
    fireEvent.keyDown(screen.getByTestId('goto-line-input'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith(5);
  });

  it('fires cancel from the cancel button', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId('goto-line-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
