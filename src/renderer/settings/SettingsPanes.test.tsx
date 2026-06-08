/**
 * Component tests for the settings panes (Phase 5, Stream C).
 *
 * The panes take a `settings` bag + `update` callback (no IPC — the App wires
 * those to window.notepads via useSettings). These tests assert the two
 * contracts that matter: each control READS its value from the bag, and each
 * control WRITES the correct field patch via `update` on interaction.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import type { Settings } from '@shared/ipc-contract';
import { TextEditorPane } from './TextEditorPane';
import { PersonalizationPane } from './PersonalizationPane';
import { AdvancedPane } from './AdvancedPane';
import { AboutPane } from './AboutPane';

function renderPane(node: React.ReactNode): void {
  render(<FluentProvider theme={webLightTheme}>{node}</FluentProvider>);
}

function makeSettings(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('TextEditorPane', () => {
  it('reflects word-wrap from the bag and writes the patch on toggle', () => {
    const update = vi.fn();
    renderPane(
      <TextEditorPane settings={makeSettings({ textWrapping: 'noWrap' })} update={update} />
    );
    const row = screen.getByTestId('setting-textWrapping');
    const sw = within(row).getByRole('switch');
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ textWrapping: 'wrap' });
  });

  it('shows the custom-search-URL row only when searchEngine is custom', () => {
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <TextEditorPane settings={makeSettings({ searchEngine: 'bing' })} update={vi.fn()} />
      </FluentProvider>
    );
    expect(screen.queryByTestId('setting-customSearchUrl')).toBeNull();
    rerender(
      <FluentProvider theme={webLightTheme}>
        <TextEditorPane settings={makeSettings({ searchEngine: 'custom' })} update={vi.fn()} />
      </FluentProvider>
    );
    expect(screen.getByTestId('setting-customSearchUrl')).toBeInTheDocument();
  });

  it('writes editorFontSize when the spin button changes', () => {
    const update = vi.fn();
    renderPane(<TextEditorPane settings={makeSettings({ editorFontSize: 14 })} update={update} />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.blur(input);
    expect(update).toHaveBeenCalledWith({ editorFontSize: 18 });
  });

  it('writes tabIndents when a tab-width radio is chosen (UWP radio set)', () => {
    const update = vi.fn();
    renderPane(<TextEditorPane settings={makeSettings({ tabIndents: -1 })} update={update} />);
    const row = screen.getByTestId('setting-tabIndents');
    // "4 Spaces" is the 4-width radio (ported TabKey FourSpaces .resw label).
    fireEvent.click(within(row).getByRole('radio', { name: '4 Spaces' }));
    expect(update).toHaveBeenCalledWith({ tabIndents: 4 });
  });

  it('writes defaultLineEnding when a line-ending radio is chosen', () => {
    const update = vi.fn();
    renderPane(
      <TextEditorPane settings={makeSettings({ defaultLineEnding: 'crlf' })} update={update} />
    );
    const row = screen.getByTestId('setting-defaultLineEnding');
    fireEvent.click(within(row).getByRole('radio', { name: 'Unix (LF)' }));
    expect(update).toHaveBeenCalledWith({ defaultLineEnding: 'lf' });
  });

  it('writes defaultEncoding when an encoding radio is chosen (was free-text input)', () => {
    const update = vi.fn();
    renderPane(
      <TextEditorPane settings={makeSettings({ defaultEncoding: 'UTF-8' })} update={update} />
    );
    const row = screen.getByTestId('setting-defaultEncoding');
    fireEvent.click(within(row).getByRole('radio', { name: 'UTF-8-BOM' }));
    expect(update).toHaveBeenCalledWith({ defaultEncoding: 'UTF-8-BOM' });
  });
});

describe('PersonalizationPane', () => {
  it('reflects themeMode and writes on radio change', () => {
    const update = vi.fn();
    renderPane(
      <PersonalizationPane settings={makeSettings({ themeMode: 'system' })} update={update} />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(update).toHaveBeenCalledWith({ themeMode: 'dark' });
  });

  it('hides the custom-accent row when Windows accent is on', () => {
    renderPane(
      <PersonalizationPane
        settings={makeSettings({ useWindowsAccentColor: true })}
        update={vi.fn()}
      />
    );
    expect(screen.queryByTestId('setting-customAccentColor')).toBeNull();
  });

  it('shows + writes the custom accent when Windows accent is off', () => {
    const update = vi.fn();
    renderPane(
      <PersonalizationPane
        settings={makeSettings({ useWindowsAccentColor: false, customAccentColor: '#0078D4' })}
        update={update}
      />
    );
    const input = screen.getByTestId('setting-customAccentColor-input');
    fireEvent.change(input, { target: { value: '#FF0000' } });
    expect(update).toHaveBeenCalledWith({ customAccentColor: '#FF0000' });
  });
});

describe('AdvancedPane', () => {
  it('reflects showStatusBar and writes on toggle', () => {
    const update = vi.fn();
    renderPane(<AdvancedPane settings={makeSettings({ showStatusBar: true })} update={update} />);
    const row = screen.getByTestId('setting-showStatusBar');
    const sw = within(row).getByRole('switch');
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(update).toHaveBeenCalledWith({ showStatusBar: false });
  });

  it('renders the language selector', () => {
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    expect(screen.getByTestId('setting-appLanguage')).toBeInTheDocument();
  });
});

describe('AboutPane', () => {
  it('shows the version and the source-code link', () => {
    renderPane(<AboutPane />);
    expect(screen.getByTestId('about-version')).toHaveTextContent('Version');
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute(
      'href',
      'https://github.com/0x7c13/Notepads'
    );
  });
});
