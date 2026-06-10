/**
 * SettingsSurface close-transition regression tests.
 *
 * The acrylic backdrop blur is suppressed (via data-acrylic-animating +
 * acrylic.css) while the pane is IN MOTION as a perf gate. That gate must apply
 * only to the ENTER slide: if it also fires during the close (exit) slide, the
 * 30px blur over the app content snaps off in a single frame while the pane
 * still fully covers it — the visible "flash" when dismissing settings.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * jsdom has no AnimationEvent constructor, which breaks animationend delivery
 * twice over: fireEvent.animationEnd drops `animationName` (plain Event
 * fallback), and React DOM, seeing no window.AnimationEvent, registers the
 * vendor-prefixed `webkitanimationend` listener instead of `animationend`.
 * Dispatch hand-built events under both names with the name attached.
 */
function fireAnimationEnd(el: Element, animationName: string): void {
  for (const type of ['animationend', 'webkitAnimationEnd']) {
    const ev = new Event(type, { bubbles: true });
    Object.assign(ev, { animationName });
    fireEvent(el, ev);
  }
}
import { webLightTheme } from '@fluentui/react-components';
import { DEFAULT_SETTINGS, type Settings } from '@shared/ipc-contract';
import { I18nProvider } from '../i18n/I18nProvider';
import { SettingsSurface } from './SettingsSurface';

function installNotepadsMock(): void {
  (globalThis as unknown as { window: Window }).window.notepads = {
    settings: {
      get: vi.fn(async () => ({ ok: true as const, data: { ...DEFAULT_SETTINGS } })),
      set: vi.fn(async (patch: Partial<Settings>) => ({
        ok: true as const,
        data: { ...DEFAULT_SETTINGS, ...patch }
      })),
      onChanged: () => () => {}
    }
  } as unknown as typeof window.notepads;
}

function renderSurface(open: boolean): ReturnType<typeof render> {
  installNotepadsMock();
  return render(
    <I18nProvider>
      <SettingsSurface
        open={open}
        onOpenChange={() => {}}
        settings={{ ...DEFAULT_SETTINGS }}
        update={() => {}}
        theme={webLightTheme}
      />
    </I18nProvider>
  );
}

function reRenderSurface(rerender: (ui: React.ReactNode) => void, open: boolean): void {
  rerender(
    <I18nProvider>
      <SettingsSurface
        open={open}
        onOpenChange={() => {}}
        settings={{ ...DEFAULT_SETTINGS }}
        update={() => {}}
        theme={webLightTheme}
      />
    </I18nProvider>
  );
}

describe('SettingsSurface close transition', () => {
  it('suppresses the blur during the enter slide and enables it once settled', () => {
    renderSurface(true);
    const surface = screen.getByTestId('settings-surface');

    // In motion (entering): blur suppressed.
    expect(surface).toHaveAttribute('data-acrylic-animating');

    // Enter slide finished: blur on.
    fireAnimationEnd(surface, 'np-settings-enter');
    expect(surface).not.toHaveAttribute('data-acrylic-animating');
  });

  it('keeps the blur ON during the exit slide (no one-frame sharp flash)', () => {
    const { rerender } = renderSurface(true);
    const surface = screen.getByTestId('settings-surface');
    fireAnimationEnd(surface, 'np-settings-enter');

    // Request close: the pane stays mounted playing np-settings-exit.
    reRenderSurface(rerender, false);
    const closingSurface = screen.getByTestId('settings-surface');
    expect(closingSurface).toBeInTheDocument();

    // The blur must NOT snap off while the pane still covers the app content.
    expect(closingSurface).not.toHaveAttribute('data-acrylic-animating');

    // Exit slide finished: the surface unmounts.
    fireAnimationEnd(closingSurface, 'np-settings-exit');
    expect(screen.queryByTestId('settings-surface')).toBeNull();
  });

  it('keeps the SAME DOM node across the close edge (no unmount/remount blink)', () => {
    const { rerender } = renderSurface(true);
    const surface = screen.getByTestId('settings-surface');
    const overlay = screen.getByTestId('settings-overlay');
    fireAnimationEnd(surface, 'np-settings-enter');

    // `closing` must be derived in the SAME render that sees open=false. If it
    // is only set in an effect, React first commits `return null` (overlay torn
    // down) and then remounts a fresh node — destroying and recreating the
    // backdrop-filter layer mid-close, which blinks.
    reRenderSurface(rerender, false);
    expect(screen.getByTestId('settings-overlay')).toBe(overlay);
    expect(screen.getByTestId('settings-surface')).toBe(surface);
  });
});
