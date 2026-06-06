/**
 * ============================================================================
 *  Custom caption controls (min / max-restore / close) — RENDERER
 * ============================================================================
 *
 * Replaces Electron's OS titleBarOverlay (an opaque band that could never blur
 * with the acrylic chrome). These are in-app React buttons painted TRANSPARENT at
 * rest so the window's acrylic shows straight through them, then a grey wash on
 * hover/press — a 1:1 port of the UWP ApplyThemeForTitleBarButtons scheme
 * (Notepads/Services/ThemeSettingsService.cs:297-333):
 *
 *   Dark : fg White,  hover bg RGB(90,90,90),  pressed bg RGB(120,120,120)
 *   Light: fg Black,  hover bg RGB(180,180,180), pressed bg RGB(150,150,150)
 *   Close: standard Win11 red hover #C42B1C / pressed #C84031, white glyph.
 *
 * Glyphs are Segoe MDL2 Assets caption codepoints (Chrome* set), matching the
 * iconography the OS overlay drew: minimize E921, maximize E922, restore E923,
 * close E8BB. Each button is 46×32 (Win11 caption metrics) and marked no-drag so
 * clicks land instead of moving the window.
 *
 * Tradeoff (accepted): without the OS maximize button the Win11 snap-assist hover
 * flyout is unavailable; Aero Snap (drag-to-edge) + Win+Arrow still work.
 *
 * PA-8: renderer-only. Window ops route through window.notepads.window.*.
 */

import { useEffect, useState } from 'react';
import { SEGOE_MDL2_FONT_FAMILY } from '../tabs/tokens';
import type { TabTheme } from '../tabs/tokens';
import { useT } from '../i18n';

/** Segoe MDL2 Assets caption glyphs (verbatim codepoints the OS overlay used). */
const CaptionGlyph = {
  minimize: '',
  maximize: '',
  restore: '',
  close: '',
} as const;

/** Win11 caption-button metrics. */
const BTN_WIDTH = 46;
const BTN_HEIGHT = 32;

/** Per-theme hover/pressed wash for the non-close buttons (UWP greys). */
function neutralWash(theme: TabTheme): { hover: string; pressed: string; fg: string } {
  if (theme === 'dark') {
    return { hover: 'rgb(90,90,90)', pressed: 'rgb(120,120,120)', fg: '#FFFFFF' };
  }
  if (theme === 'hc') {
    // HC: defer to forced-colors system keywords so the buttons stay legible.
    return { hover: 'Highlight', pressed: 'Highlight', fg: 'CanvasText' };
  }
  return { hover: 'rgb(180,180,180)', pressed: 'rgb(150,150,150)', fg: '#000000' };
}

interface CaptionButtonProps {
  glyph: string;
  label: string;
  testid: string;
  fg: string;
  hoverBg: string;
  pressedBg: string;
  /** Close uses a white glyph on its red hover/press (override fg while pressed/hovered). */
  hoverFg?: string;
  onClick(): void;
}

function CaptionButton(props: CaptionButtonProps): JSX.Element {
  const { glyph, label, testid, fg, hoverBg, pressedBg, hoverFg, onClick } = props;
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const bg = pressed ? pressedBg : hovered ? hoverBg : 'transparent';
  const color = (hovered || pressed) && hoverFg ? hoverFg : fg;
  return (
    <button
      type="button"
      data-testid={testid}
      data-no-drag
      aria-label={label}
      title={label}
      tabIndex={-1}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: BTN_WIDTH,
        height: BTN_HEIGHT,
        flex: '0 0 auto',
        border: 'none',
        padding: 0,
        margin: 0,
        background: bg,
        color,
        cursor: 'default',
        // The OS overlay had no transition; a short fade keeps it from flickering
        // but stays subtle (Win11 caption buttons cross-fade their hover layer).
        transition: 'background-color 90ms linear',
        fontFamily: SEGOE_MDL2_FONT_FAMILY,
        fontSize: 10,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {glyph}
    </button>
  );
}

export interface CaptionButtonsProps {
  /** Resolved strip theme — selects the UWP grey wash + glyph color. */
  theme: TabTheme;
}

/**
 * The min / max-restore / close cluster, pinned to the top-right of the chrome.
 * Tracks the live maximized flag (seeded via window.isMaximized, kept in sync via
 * onMaximizeChanged) so the middle button swaps between the maximize + restore
 * glyphs exactly like the OS button did.
 */
export function CaptionButtons(props: CaptionButtonsProps): JSX.Element {
  const { theme } = props;
  const { t } = useT();
  const [maximized, setMaximized] = useState(false);
  const wash = neutralWash(theme);

  useEffect(() => {
    // Seed the initial maximized flag, then stay in sync with every state change
    // (our button, a drag-region double-click, Aero Snap, Win+Up).
    void window.notepads.window.isMaximized().then((res) => {
      if (res.ok) setMaximized(res.data.isMaximized);
    });
    return window.notepads.window.onMaximizeChanged((isMax) => setMaximized(isMax));
  }, []);

  return (
    <div
      data-testid="caption-buttons"
      data-no-drag
      style={{ display: 'flex', alignItems: 'stretch', flex: '0 0 auto', height: BTN_HEIGHT }}
    >
      <CaptionButton
        glyph={CaptionGlyph.minimize}
        label={t('Caption_Minimize')}
        testid="caption-minimize"
        fg={wash.fg}
        hoverBg={wash.hover}
        pressedBg={wash.pressed}
        onClick={() => void window.notepads.window.minimize()}
      />
      <CaptionButton
        glyph={maximized ? CaptionGlyph.restore : CaptionGlyph.maximize}
        label={maximized ? t('Caption_Restore') : t('Caption_Maximize')}
        testid="caption-maximize"
        fg={wash.fg}
        hoverBg={wash.hover}
        pressedBg={wash.pressed}
        onClick={() => {
          void window.notepads.window.toggleMaximize().then((res) => {
            if (res.ok) setMaximized(res.data.isMaximized);
          });
        }}
      />
      <CaptionButton
        glyph={CaptionGlyph.close}
        label={t('Caption_Close')}
        testid="caption-close"
        fg={wash.fg}
        // Win11 close-button red hover/press with a white glyph (theme-independent).
        hoverBg="#C42B1C"
        pressedBg="#C84031"
        hoverFg="#FFFFFF"
        onClick={() => void window.notepads.window.close()}
      />
    </div>
  );
}
