/**
 * BrowserWindowFactory (0.A decision) — hardened webPreferences.
 *
 * PA-8 mandate: contextIsolation:true, nodeIntegration:false, sandbox:true.
 * Windows: titleBarStyle:'hidden' WITHOUT a titleBarOverlay — the caption
 * (min/max/close) buttons are CUSTOM in-app React controls (CaptionButtons) so
 * they paint transparent and the window acrylic shows through them, 1:1 with the
 * UWP ApplyThemeForTitleBarButtons transparent-button scheme. The OS overlay was
 * an opaque band that could never blur with the acrylic chrome.
 */

import { BrowserWindow, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IpcChannels } from '../shared/ipc-channels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Base theme colors hardcoded per OS theme (docs/plan/02-phase-1 §5). */
const BASE_BG_DARK = '#2E2E2E';
const BASE_BG_LIGHT = '#F0F0F0';

export interface CreateWindowOptions {
  /** Extra args forwarded to the renderer (unused in skeleton). */
  showImmediately?: boolean;
}

export function createMainWindow(_options: CreateWindowOptions = {}): BrowserWindow {
  const isDark = nativeTheme.shouldUseDarkColors;

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 480,
    minHeight: 320,
    show: false,
    backgroundColor:
      process.platform === 'win32' ? '#00000000' : isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
    // Acrylic material on Win11: matches the original Notepads' wallpaper-sampling
    // translucency (acrylic samples the desktop wallpaper behind the window, unlike
    // mica which is composited from it). backgroundColor is the transparent
    // '#00000000' so the material shows through; on Win10 the renderer's tinted
    // base fills it. We must NOT set transparent:true — Win11 keeps the rounded
    // corners when only backgroundMaterial is set, but a transparent window loses
    // the DWM frame and its corner rounding. backgroundMaterial drives the blur.
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    autoHideMenuBar: true,
    // Frameless on Windows: hide the OS title bar (and its caption-button overlay)
    // so our custom transparent CaptionButtons own the top-right. Aero Snap (drag
    // to edge) + Win+Arrow still work; only the Win11 snap-assist hover flyout is
    // unavailable without the OS maximize button — an accepted tradeoff for the
    // transparent-button fidelity (matches the UWP look).
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    webPreferences: {
      // PA-8 HARD RULE — do not weaken.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Push maximized-state changes to the renderer so the custom max/restore glyph
  // stays correct when the window is maximized/restored by ANY path (our button,
  // a drag-region double-click, Aero Snap, Win+Up). The renderer subscribes via
  // window.notepads.window.onMaximizeChanged.
  const sendMaxState = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(IpcChannels.WindowMaximizeChanged, win.isMaximized());
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);

  return win;
}
