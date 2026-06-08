/**
 * ============================================================================
 *  Windows 11 rounded-corner fix for material windows
 * ============================================================================
 *
 * Electron 33 has a known bug: a frameless window (titleBarStyle 'hidden' +
 * titleBarOverlay) combined with `backgroundMaterial: 'acrylic'` loses the DWM
 * frame's rounded corners (electron/electron#42393, #46753). Electron exposes no
 * JS API for the corner preference (`roundedCorners` is macOS-only), so we call
 * the Win32 DWM API directly via koffi (prebuilt FFI, no native build step):
 *
 *   DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)
 *
 * This is a best-effort cosmetic enhancement: every failure path (non-win32,
 * koffi load failure, missing dwmapi, sandboxed CI) is swallowed so it can never
 * break window creation. MAIN-process only — never touches the renderer (PA-8).
 */

import type { BrowserWindow } from 'electron';

/** DWMWINDOWATTRIBUTE.DWMWA_WINDOW_CORNER_PREFERENCE */
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
/** DWM_WINDOW_CORNER_PREFERENCE.DWMWCP_ROUND */
const DWMWCP_ROUND = 2;

type DwmSetFn = (hwnd: bigint, attr: number, pv: Buffer, cb: number) => number;

let dwmSet: DwmSetFn | null | undefined;

/** Lazily bind DwmSetWindowAttribute from dwmapi.dll. Cached; null if unavailable. */
function getDwmSet(): DwmSetFn | null {
  if (dwmSet !== undefined) return dwmSet;
  if (process.platform !== 'win32') return (dwmSet = null);
  try {
    // Required lazily so non-win32 / koffi-less environments never load it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi') as typeof import('koffi');
    const dwmapi = koffi.load('dwmapi.dll');
    dwmSet = dwmapi.func(
      'int DwmSetWindowAttribute(void *hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)'
    ) as unknown as DwmSetFn;
  } catch {
    dwmSet = null;
  }
  return dwmSet;
}

/** Read the HWND value out of Electron's native-handle buffer (arch-aware). */
function hwndOf(win: BrowserWindow): bigint | null {
  try {
    const buf = win.getNativeWindowHandle();
    if (buf.length >= 8) return buf.readBigUInt64LE(0);
    if (buf.length >= 4) return BigInt(buf.readUInt32LE(0));
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Force the DWM round-corner preference on a window. No-op off win32 or when the
 * DWM binding is unavailable. Re-applied on focus/maximize transitions because
 * the material window can revert to square corners across those state changes.
 */
export function applyRoundedCorners(win: BrowserWindow): void {
  const fn = getDwmSet();
  if (!fn || win.isDestroyed()) return;
  const hwnd = hwndOf(win);
  if (hwnd === null) return;
  try {
    const pref = Buffer.alloc(4);
    pref.writeUInt32LE(DWMWCP_ROUND, 0);
    fn(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, pref, 4);
  } catch {
    /* best-effort cosmetic; never throw into window setup */
  }
}

/**
 * Install the corner fix on a window: apply once it is shown, and re-apply on the
 * state transitions that revert it (focus / maximize / unmaximize), with the
 * listeners torn down on close.
 */
export function installRoundedCorners(win: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const reapply = (): void => applyRoundedCorners(win);
  win.once('ready-to-show', reapply);
  win.on('focus', reapply);
  win.on('maximize', reapply);
  win.on('unmaximize', reapply);
  win.once('closed', () => {
    win.removeListener('focus', reapply);
    win.removeListener('maximize', reapply);
    win.removeListener('unmaximize', reapply);
  });
}
