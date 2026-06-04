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

/**
 * Caption-button (titleBarOverlay) colors for the current OS theme. The overlay
 * draws the OS Segoe Fluent min/max/close glyphs; we only own the band color and
 * the symbol color so the caption buttons stay legible in both themes. The glyphs
 * themselves are OS-drawn and untouched.
 */
function captionColors(isDark: boolean): { color: string; symbolColor: string } {
  return {
    color: isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
    symbolColor: isDark ? '#FFFFFF' : '#000000',
  };
}

/**
 * Re-apply the caption colors for the current OS theme. Windows-only (the overlay
 * exists only there). No-op if the window has no overlay (other platforms) or is
 * gone. Called at creation and on every live OS-theme change so the caption
 * buttons re-tint without a relaunch (UWP updates the caption live).
 */
function applyCaptionTheme(win: BrowserWindow): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return;
  const { color, symbolColor } = captionColors(nativeTheme.shouldUseDarkColors);
  win.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_OVERLAY_HEIGHT });
}

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
    backgroundColor: process.platform === 'win32' ? '#00000000' : isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
    // Mica material on Win11: the desktop wallpaper shows through behind the
    // translucent renderer tint. backgroundColor is transparent so the material
    // is visible; on Win10 (no mica) the renderer's tinted base still fills it.
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    autoHideMenuBar: true,
    // Snap Layouts on Windows via overlaid caption controls.
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            ...captionColors(isDark),
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

  // Live-update the caption-button colors on OS-theme change (Phase 7). Each
  // window subscribes to nativeTheme and re-tints its overlay; the listener is
  // removed when the window closes so it does not leak or fire on a dead window.
  if (process.platform === 'win32') {
    const onThemeUpdated = (): void => applyCaptionTheme(win);
    nativeTheme.on('updated', onThemeUpdated);
    win.once('closed', () => nativeTheme.removeListener('updated', onThemeUpdated));
  }

  return win;
}
