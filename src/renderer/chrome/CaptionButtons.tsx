/**
 * ============================================================================
 *  Custom caption controls (min / max-restore / close) — RENDERER
 * ============================================================================
 *
 * Replaces Electron's OS titleBarOverlay (an opaque band that could never blur
 * with the acrylic chrome). These are in-app React buttons painted TRANSPARENT at
 * rest so the window's acrylic/vibrancy shows straight through them, then a grey
 * wash on hover/press — a 1:1 port of the UWP ApplyThemeForTitleBarButtons scheme.
 *
 * Cross-platform: renders on Windows (acrylic backdrop), macOS (vibrancy backdrop),
 * and Linux. Icons are Fluent UI v9 SVG components — no Windows-only Segoe MDL2
 * font dependency.
 *
 *   Dark : fg White,  hover bg RGB(90,90,90),  pressed bg RGB(120,120,120)
 *   Light: fg Black,  hover bg RGB(180,180,180), pressed bg RGB(150,150,150)
 *   Close: standard Win11 red hover #C42B1C / pressed #C84031, white glyph.
 *
 * PA-8: renderer-only. Window ops route through window.notepads.window.*.
 */

import { type FC, useEffect, useState } from 'react';
import {
  SubtractRegular,
  SquareRegular,
  SquareMultipleRegular,
  DismissRegular,
} from '@fluentui/react-icons';
import type { TabTheme } from '../tabs/tokens';
import { useT } from '../i18n';

const CaptionGlyph = {
  minimize: SubtractRegular as FC,
  maximize: SquareRegular as FC,
  restore: SquareMultipleRegular as FC,
  close: DismissRegular as FC,
} as const;

const BTN_WIDTH = 46;
const BTN_HEIGHT = 32;

function neutralWash(theme: TabTheme): { hover: string; pressed: string; fg: string } {
  if (theme === 'dark') {
    return { hover: 'rgb(90,90,90)', pressed: 'rgb(120,120,120)', fg: '#FFFFFF' };
  }
  if (theme === 'hc') {
    return { hover: 'Highlight', pressed: 'Highlight', fg: 'CanvasText' };
  }
  return { hover: 'rgb(180,180,180)', pressed: 'rgb(150,150,150)', fg: '#000000' };
}

interface CaptionButtonProps {
  /** Fluent UI icon component to render. */
  icon: FC;
  label: string;
  testid: string;
  fg: string;
  hoverBg: string;
  pressedBg: string;
  hoverFg?: string;
  onClick(): void;
}

function CaptionButton(props: CaptionButtonProps): JSX.Element {
  const { icon: Icon, label, testid, fg, hoverBg, pressedBg, hoverFg, onClick } = props;
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
        transition: 'background-color 90ms linear',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon />
    </button>
  );
}

export interface CaptionButtonsProps {
  theme: TabTheme;
}

export function CaptionButtons(props: CaptionButtonsProps): JSX.Element {
  const { theme } = props;
  const { t } = useT();
  const [maximized, setMaximized] = useState(false);
  const wash = neutralWash(theme);

  useEffect(() => {
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
        icon={CaptionGlyph.minimize}
        label={t('Caption_Minimize')}
        testid="caption-minimize"
        fg={wash.fg}
        hoverBg={wash.hover}
        pressedBg={wash.pressed}
        onClick={() => void window.notepads.window.minimize()}
      />
      <CaptionButton
        icon={maximized ? CaptionGlyph.restore : CaptionGlyph.maximize}
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
        icon={CaptionGlyph.close}
        label={t('Caption_Close')}
        testid="caption-close"
        fg={wash.fg}
        hoverBg="#C42B1C"
        pressedBg="#C84031"
        hoverFg="#FFFFFF"
        onClick={() => void window.notepads.window.close()}
      />
    </div>
  );
}
