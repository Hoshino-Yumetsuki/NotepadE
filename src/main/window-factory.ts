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
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  const win = new BrowserWindow({
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    minWidth: 480,
    minHeight: 320,
    show: false,
    ...(existsSync(APP_ICON_PATH) ? { icon: APP_ICON_PATH } : {}),
    backgroundColor: isWindows || isMac ? '#00000000' : isDark ? BASE_BG_DARK : BASE_BG_LIGHT,
    // Windows: Acrylic material on Win11 — matches the original Notepads'
    // wallpaper-sampling translucency. backgroundColor is transparent so the
    // material shows through. MUST NOT set transparent:true on Win11 — that loses
    // the DWM frame and its rounded corners. backgroundMaterial alone drives blur.
    ...(isWindows ? { backgroundMaterial: 'acrylic' as const } : {}),
    // macOS: Vibrancy for native "frosted glass" translucency. Combines with
    // transparent:true + backgroundColor:'#00000000' so the desktop wallpaper
    // samples through the NSVisualEffectView. visualEffectState:'active' keeps
    // the blur consistent regardless of window focus.
    //
    // KNOWN LIMITATION (mac transparency setting): the renderer's tint layer
    // (appBackgroundTint alpha = settings.tintOpacity) has little/no visible
    // effect over vibrancy. Unlike Win11's backgroundMaterial:'acrylic' — a
    // plain wallpaper blur the rgba tint composites over linearly — macOS's
    // NSVisualEffectView applies its OWN adaptive material recipe (system tint
    // + saturation + luminosity mixing), so an in-page semi-transparent wash
    // over it is largely swallowed by the material's own blending and the
    // slider reads as a no-op. There is no Electron knob to drive the
    // NSVisualEffectView's material opacity at runtime, so this is accepted
    // as-is for the no-wallpaper look. The CROSS-PLATFORM answer is the custom
    // wallpaper feature (main/wallpaper.ts + renderer theme/wallpaper.ts):
    // with a wallpaper active the renderer paints an OPAQUE base + an in-page
    // image layer whose opacity the same slider drives — pure CSS, identical
    // on mac/win/linux, vibrancy no longer participates.
    ...(isMac
      ? {
          transparent: true,
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
          hasShadow: false // transparent windows lose the macOS shadow
        }
      : {}),
    autoHideMenuBar: true,
    // Platform-aware title bar:
    //   Windows: 'hidden' (frameless, custom CaptionButtons)
    //   macOS: 'hidden' (frameless, traffic lights pushed off-screen, custom CaptionButtons)
    //   Linux: 'default' (native title bar)
    ...(isMac
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: -80, y: -20 } as const,
          titleBarOverlay: true
        }
      : {
          titleBarStyle: isWindows ? ('hidden' as const) : ('default' as const)
        }),
    webPreferences: {
      // PA-8 HARD RULE — do not weaken.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js')
    }
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
