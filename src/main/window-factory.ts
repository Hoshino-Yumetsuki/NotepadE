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
import { existsSync } from 'node:fs';
import { IpcChannels } from '../shared/ipc-channels.js';
import { installCloseGuard } from './window.js';
import { restoredWindowOptions, trackWindowBounds, DEFAULT_BOUNDS } from './window-bounds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * App icon (the original Notepads "N_" logo, src/Notepads/Assets/appicon_b.png).
 * Vite copies src/renderer/public/icon.png → out/renderer/icon.png, a sibling of
 * out/main. Set explicitly so the dev window, the taskbar, and the Linux build
 * carry it; the packaged Windows .exe also embeds it via electron-builder's
 * build/icon.png. Resolved defensively (existsSync) so a missing asset never
 * throws — Electron just falls back to its default icon.
 */
const APP_ICON_PATH = join(__dirname, '../renderer/icon.png');

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
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    minWidth: 480,
    minHeight: 320,
    show: false,
    ...(existsSync(APP_ICON_PATH) ? { icon: APP_ICON_PATH } : {}),
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
    // Restore the last session's window bounds + maximized state before first paint.
    // Returns null under e2e / first run → keep the original show()-only path so the
    // default-sized window stays pixel-identical (visual goldens depend on it).
    void restoredWindowOptions()
      .then((opts) => {
        if (win.isDestroyed() || !opts) return;
        if (typeof opts.x === 'number' && typeof opts.y === 'number') {
          win.setBounds({ x: opts.x, y: opts.y, width: opts.width, height: opts.height });
        } else {
          win.setSize(opts.width, opts.height);
          win.center();
        }
        if (opts.restoreMaximized) win.maximize();
      })
      .finally(() => {
        if (!win.isDestroyed()) win.show();
      });
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

  // Intercept native close (X / Alt+F4 / OS) so the renderer can run the
  // unsaved-changes flow before the window actually closes (UWP CloseRequested).
  installCloseGuard(win);

  // Persist size/position/maximized across launches (UWP got this from the OS
  // shell). No-op under e2e for deterministic fixed-size specs.
  trackWindowBounds(win);

  return win;
}
