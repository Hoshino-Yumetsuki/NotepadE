/**
 * Wave-2 proof: a useT() consumer wired the way App's settings button is wired
 * re-localizes its visible label on a settings.appLanguage switch with NO reload.
 *
 * This mirrors the production wiring (main.tsx wraps the tree in <I18nProvider>;
 * the settings toolbar Button's aria-label/title come from
 * useT('MainMenu_Button_Settings.Text')) on an isolated consumer, so the runtime
 * switch is covered by a fast vitest unit rather than only the Playwright matrix.
 * lane-h's Gate-6 line-3 asserts the same en-US vs zh-CN DOM difference end-to-end.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Settings } from '@shared/ipc-contract';
import { I18nProvider, useT } from './I18nProvider';
import { tableFor } from './resolve';

const SETTINGS_KEY = 'MainMenu_Button_Settings.Text';

let changedCb: ((s: Settings) => void) | null = null;

function installMock(initial: Partial<Settings> = {}): void {
  const bag: Settings = { ...DEFAULT_SETTINGS, ...initial };
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: bag })),
      set: vi.fn(async (patch: Partial<Settings>) => ({
        ok: true as const,
        data: { ...bag, ...patch },
      })),
      onChanged: (cb: (s: Settings) => void) => {
        changedCb = cb;
        return () => {
          changedCb = null;
        };
      },
    },
  } as unknown as typeof window.notepads;
}

function broadcast(patch: Partial<Settings>): void {
  act(() => changedCb?.({ ...DEFAULT_SETTINGS, ...patch }));
}

/** A stand-in for App's settings Button: label sourced from useT, same key. */
function SettingsButtonProbe(): JSX.Element {
  const { t } = useT();
  const label = t(SETTINGS_KEY);
  return (
    <button data-testid="open-settings" aria-label={label} title={label}>
      gear
    </button>
  );
}

describe('wave-2 settings-button label runtime switch', () => {
  beforeEach(() => {
    changedCb = null;
  });

  it('renders the en-US label and switches to zh-CN on appLanguage change (no reload)', async () => {
    installMock({ appLanguage: 'en-US' });
    render(
      <I18nProvider>
        <SettingsButtonProbe />
      </I18nProvider>,
    );

    const en = tableFor('en-US')[SETTINGS_KEY];
    const zh = tableFor('zh-CN')[SETTINGS_KEY];
    // Guard the fixture: the two locales must actually differ or the assertion is vacuous.
    expect(en).not.toBe(zh);

    const btn = await screen.findByTestId('open-settings');
    expect(btn.getAttribute('aria-label')).toBe(en);

    broadcast({ appLanguage: 'zh-CN' });

    expect(btn.getAttribute('aria-label')).toBe(zh);
    expect(btn.getAttribute('title')).toBe(zh);
  });
});
