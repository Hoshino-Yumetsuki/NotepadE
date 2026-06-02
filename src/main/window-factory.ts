/**
 * BrowserWindowFactory (0.A decision) — hardened webPreferences.
 *
 * PA-8 mandate: contextIsolation:true, nodeIntegration:false, sandbox:true.
 * Windows: titleBarStyle:'hidden' + titleBarOverlay for Snap Layouts; the UWP
 * TitleBarReservedArea (180px) maps to the overlay width.
 */

import { BrowserWindow, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Base theme colors hardcoded per OS theme (docs/plan/02-phase-1 §5). */
const BASE_BG_DARK = '#2E2E2E';
const BASE_BG_LIGHT = '#F0F0F0';

/** UWP TitleBarReservedArea width reserved for the caption band. */
const TITLE_BAR_OVERLAY_HEIGHT = 32;

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
    backgroundColor: isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
    autoHideMenuBar: true,
    // Snap Layouts on Windows via overlaid caption controls.
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
            symbolColor: isDark ? '#FFFFFF' : '#000000',
            height: TITLE_BAR_OVERLAY_HEIGHT,
          },
        }
      : {}),
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

  return win;
}
