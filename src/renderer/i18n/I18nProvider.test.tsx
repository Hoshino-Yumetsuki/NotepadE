/**
 * Runtime-switch test for <I18nProvider> + useT (Wave 1 proof).
 *
 * Proves the requirement WITHOUT touching any app component: an isolated consumer
 * renders a real key, and flipping settings.appLanguage via the mocked
 * settings.onChanged broadcast re-localizes it with NO reload. Also covers the
 * '' = follow-OS path, missing-key fallback, and UWP-parity plural selection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Settings } from '@shared/ipc-contract';
import { I18nProvider, useT } from './I18nProvider';
import { tableFor } from './resolve';

let changedCb: ((s: Settings) => void) | null = null;

function installMock(initial: Partial<Settings> = {}): void {
  const bag: Settings = { ...DEFAULT_SETTINGS, ...initial };
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: bag })),
      set: vi.fn(async (patch: Partial<Settings>) => ({
        ok: true as const,
        data: { ...bag, ...patch }
      })),
      onChanged: (cb: (s: Settings) => void) => {
        changedCb = cb;
        return () => {
          changedCb = null;
        };
      }
    }
  } as unknown as typeof window.notepads;
}

/** Broadcast a settings change exactly as MAIN would (no reload). */
function broadcast(patch: Partial<Settings>): void {
  act(() => changedCb?.({ ...DEFAULT_SETTINGS, ...patch }));
}

/** A tiny consumer that renders one real ported key + a plural sample. */
function Probe(): JSX.Element {
  const { t, plural, locale } = useT();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="ok">{t('FileOpenErrorDialog_PrimaryButtonText')}</span>
      <span data-testid="fmt">{t('FileOpenErrorDialog_Content', 'a.txt', 'denied')}</span>
      <span data-testid="missing">{t('Totally_Unknown_Key')}</span>
      <span data-testid="plural-1">
        {plural(
          1,
          'TextEditor_LineColumnIndicator_FullText_SingularSelectedWord',
          'TextEditor_LineColumnIndicator_FullText_PluralSelectedWord'
        )}
      </span>
    </div>
  );
}

describe('I18nProvider + useT runtime switch', () => {
  beforeEach(() => {
    changedCb = null;
  });

  it('renders en-US by default and substitutes {0}/{1}', async () => {
    installMock({ appLanguage: 'en-US' });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    await screen.findByText(tableFor('en-US').FileOpenErrorDialog_PrimaryButtonText);
    expect(screen.getByTestId('locale').textContent).toBe('en-US');
    expect(screen.getByTestId('fmt').textContent).toBe(
      'Sorry, file "a.txt" couldn\'t be opened: denied'
    );
  });

  it('re-localizes with NO reload when appLanguage changes via onChanged', async () => {
    installMock({ appLanguage: 'en-US' });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    await screen.findByText(tableFor('en-US').FileOpenErrorDialog_PrimaryButtonText);

    broadcast({ appLanguage: 'ja-JP' });

    expect(screen.getByTestId('locale').textContent).toBe('ja-JP');
    expect(screen.getByTestId('ok').textContent).toBe(
      tableFor('ja-JP').FileOpenErrorDialog_PrimaryButtonText
    );
    // The placeholder template must format in the new locale too.
    expect(screen.getByTestId('fmt').textContent).toContain('a.txt');
  });

  it("follows the OS UI language when appLanguage is '' ", async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE', 'en-US']);
    installMock({ appLanguage: '' });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    await screen.findByText(tableFor('de-DE').FileOpenErrorDialog_PrimaryButtonText);
    expect(screen.getByTestId('locale').textContent).toBe('de-DE');
    vi.restoreAllMocks();
  });

  it('falls back to the key itself for an unknown key', async () => {
    installMock({ appLanguage: 'en-US' });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    await screen.findByTestId('missing');
    expect(screen.getByTestId('missing').textContent).toBe('Totally_Unknown_Key');
  });

  it('selects the singular key for count 1 (UWP plural parity)', async () => {
    installMock({ appLanguage: 'en-US' });
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    await screen.findByTestId('plural-1');
    expect(screen.getByTestId('plural-1').textContent).toBe(
      tableFor('en-US').TextEditor_LineColumnIndicator_FullText_SingularSelectedWord
    );
  });
});
