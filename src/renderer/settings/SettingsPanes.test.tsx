/**
 * Component tests for the settings panes (Phase 5, Stream C).
 *
 * The panes take a `settings` bag + `update` callback (no IPC — the App wires
 * those to window.notepads via useSettings). These tests assert the two
 * contracts that matter: each control READS its value from the bag, and each
 * control WRITES the correct field patch via `update` on interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DEFAULT_SETTINGS } from '@shared/ipc-contract';
import type { Settings } from '@shared/ipc-contract';
import { TextEditorPane } from './TextEditorPane';
import { PersonalizationPane } from './PersonalizationPane';
import { AdvancedPane } from './AdvancedPane';
import { AboutPane } from './AboutPane';

// The wallpaper / reset mocks below install namespaces onto window.notepads.
// Snapshot whatever the suite started with and restore it after every test so
// a mock from one test can never leak into another (or into a future test file
// sharing this jsdom) — the mocks MERGE into the global rather than replacing
// it, so sibling namespaces installed elsewhere survive too.
let originalNotepads: typeof window.notepads | undefined;

beforeEach(() => {
  originalNotepads = window.notepads;
});

afterEach(() => {
  (window as { notepads?: typeof window.notepads }).notepads = originalNotepads;
});

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

  // --- custom wallpaper (web port) ---
  // The pane drives window.notepads.wallpaper directly (MAIN owns the file
  // lifecycle; the persisted name flows back via the shared settings bag), so
  // these tests mock the wallpaper namespace instead of asserting update().
  function mockWallpaperApi(): {
    setFromUrl: ReturnType<typeof vi.fn>;
    pick: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  } {
    const api = {
      get: vi.fn().mockResolvedValue({ ok: true, data: { fileName: '', dataUrl: null } }),
      setFromPath: vi.fn(),
      setFromUrl: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { fileName: 'wallpaper-1.png', dataUrl: 'data:' } }),
      pick: vi.fn().mockResolvedValue({ ok: true, data: null }),
      clear: vi.fn().mockResolvedValue({ ok: true, data: undefined })
    };
    // MERGE the namespace into window.notepads (preserving any siblings another
    // suite installed) instead of replacing the whole global; afterEach above
    // restores the pre-test value.
    (window as unknown as { notepads: unknown }).notepads = {
      ...(window.notepads as object | undefined),
      wallpaper: api
    } as unknown as typeof window.notepads;
    return api;
  }

  it('sends the trimmed URL to wallpaper.setFromUrl on Set', () => {
    const api = mockWallpaperApi();
    renderPane(<PersonalizationPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.change(screen.getByTestId('setting-wallpaperUrl-input'), {
      target: { value: '  https://example.com/a.png  ' }
    });
    fireEvent.click(screen.getByTestId('setting-wallpaperUrl-apply'));
    expect(api.setFromUrl).toHaveBeenCalledWith('https://example.com/a.png');
  });

  it('disables Set while the URL field is empty', () => {
    mockWallpaperApi();
    renderPane(<PersonalizationPane settings={makeSettings()} update={vi.fn()} />);
    expect(screen.getByTestId('setting-wallpaperUrl-apply')).toBeDisabled();
  });

  it('opens the MAIN picker via wallpaper.pick on Browse', () => {
    const api = mockWallpaperApi();
    renderPane(<PersonalizationPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-wallpaperBrowse-button'));
    expect(api.pick).toHaveBeenCalledTimes(1);
  });

  it('shows Remove only while a wallpaper is active, and clears via IPC', () => {
    const api = mockWallpaperApi();
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <PersonalizationPane settings={makeSettings()} update={vi.fn()} />
      </FluentProvider>
    );
    expect(screen.queryByTestId('setting-wallpaperClear-button')).toBeNull();
    rerender(
      <FluentProvider theme={webLightTheme}>
        <PersonalizationPane
          settings={makeSettings({ wallpaperFileName: 'wallpaper-1.png' })}
          update={vi.fn()}
        />
      </FluentProvider>
    );
    fireEvent.click(screen.getByTestId('setting-wallpaperClear-button'));
    expect(api.clear).toHaveBeenCalledTimes(1);
  });

  it('surfaces MAIN errors from a failed URL download', async () => {
    const api = mockWallpaperApi();
    api.setFromUrl.mockResolvedValue({ ok: false, error: 'Download failed (HTTP 404)' });
    renderPane(<PersonalizationPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.change(screen.getByTestId('setting-wallpaperUrl-input'), {
      target: { value: 'https://example.com/missing.png' }
    });
    fireEvent.click(screen.getByTestId('setting-wallpaperUrl-apply'));
    expect(await screen.findByTestId('setting-wallpaper-error')).toHaveTextContent(
      'Download failed (HTTP 404)'
    );
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

  // --- reset all settings (web port) ---
  // The pane drives window.notepads.settings.resetAll directly (MAIN restores
  // defaults + deletes the wallpaper file; the bag reconciles via onChanged),
  // gated by a confirmation dialog — assert the gate and the IPC call.
  function mockSettingsResetApi(): { resetAll: ReturnType<typeof vi.fn> } {
    const api = {
      resetAll: vi.fn().mockResolvedValue({ ok: true, data: makeSettings() })
    };
    // MERGE like mockWallpaperApi: keep sibling namespaces, restore afterEach.
    (window as unknown as { notepads: unknown }).notepads = {
      ...(window.notepads as object | undefined),
      settings: api
    } as unknown as typeof window.notepads;
    return api;
  }

  it('opens the confirmation dialog on Reset (no IPC yet)', () => {
    const api = mockSettingsResetApi();
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-resetAll-button'));
    expect(screen.getByTestId('reset-settings-dialog')).toBeInTheDocument();
    // Destructive action MUST be confirmed first — the button alone never resets.
    expect(api.resetAll).not.toHaveBeenCalled();
  });

  it('calls settings.resetAll only after confirm', async () => {
    const api = mockSettingsResetApi();
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-resetAll-button'));
    fireEvent.click(screen.getByTestId('reset-settings-confirm'));
    expect(api.resetAll).toHaveBeenCalledTimes(1);
    // The dialog closes once MAIN resolves.
    await waitFor(() =>
      expect(screen.queryByTestId('reset-settings-dialog')).not.toBeInTheDocument()
    );
  });

  it('cancel dismisses the dialog without resetting', async () => {
    const api = mockSettingsResetApi();
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-resetAll-button'));
    fireEvent.click(screen.getByTestId('reset-settings-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('reset-settings-dialog')).not.toBeInTheDocument()
    );
    expect(api.resetAll).not.toHaveBeenCalled();
  });

  it('surfaces an ok:false reset inline and keeps the dialog open (no silent failure)', async () => {
    const api = mockSettingsResetApi();
    api.resetAll.mockResolvedValue({ ok: false, error: 'disk locked' });
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-resetAll-button'));
    fireEvent.click(screen.getByTestId('reset-settings-confirm'));
    // The MAIN error shows inline; the dialog stays open for retry/cancel.
    expect(await screen.findByTestId('reset-settings-error')).toHaveTextContent('disk locked');
    expect(screen.getByTestId('reset-settings-dialog')).toBeInTheDocument();
  });

  it('a REJECTED invoke clears busy and still allows cancel (no wedged modal)', async () => {
    const api = mockSettingsResetApi();
    api.resetAll.mockRejectedValue(new Error('ipc dropped'));
    renderPane(<AdvancedPane settings={makeSettings()} update={vi.fn()} />);
    fireEvent.click(screen.getByTestId('setting-resetAll-button'));
    fireEvent.click(screen.getByTestId('reset-settings-confirm'));
    // The rejection surfaces like an ok:false (busy is cleared in finally)...
    expect(await screen.findByTestId('reset-settings-error')).toHaveTextContent('ipc dropped');
    // ...so the cancel button is re-enabled and the dialog can be dismissed —
    // the pre-fix behavior left resetBusy=true forever (unclosable modal).
    const cancel = screen.getByTestId('reset-settings-cancel');
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(screen.queryByTestId('reset-settings-dialog')).not.toBeInTheDocument()
    );
  });
});

describe('AboutPane', () => {
  it('shows the version and the source-code link', () => {
    renderPane(<AboutPane />);
    expect(screen.getByTestId('about-version')).toHaveTextContent('Version');
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute(
      'href',
      'https://github.com/Hoshino-Yumetsuki/NotepadE'
    );
  });
});
