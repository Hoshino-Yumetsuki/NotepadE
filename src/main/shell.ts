/**
 * shell — OS integrations (MAIN, Lane B, Phase 6).
 *
 * Implements the five `window.notepads.shell.*` channels plus the jump-list
 * helper. MAIN owns ALL shell/clipboard/print/path access (PA-8); the renderer
 * only ever calls the typed bridge.
 *
 * Ports of the UWP behaviors:
 *   - openContainingFolder → `shell.showItemInFolder` (UWP "Open containing folder",
 *     FolderLauncher / Launcher.LaunchFolderAsync with the file selected).
 *   - copyPath             → `clipboard.writeText(path)` (UWP "Copy full path").
 *   - webSearch            → resolve the query to a URL (UWP SearchEngineUtility +
 *     TextEditorCore.WebSearch) then `shell.openExternal`.
 *   - print                → `webContents.print()` on the focused window. The
 *     renderer decides WHAT to render (current tab for Ctrl+P, all tabs for
 *     Ctrl+Shift+P) before invoking; MAIN just prints the visible document, so the
 *     single content-agnostic `print()` channel covers both modes (the contract is
 *     frozen + sufficient).
 *   - share                → OS share where available, else clipboard fallback.
 *     Windows/Linux have no programmatic OS share sheet from Electron MAIN, so we
 *     fall back to copying "title\n\ntext" to the clipboard (UWP DataTransferManager
 *     parity is best-effort; the clipboard fallback guarantees the user keeps the
 *     content).
 *
 * Jump list: `addRecentDocument(path)` is called by the file-open path (MAIN) so
 * recently opened files appear in the Windows taskbar Jump List / macOS Recents
 * (UWP JumpListService). No renderer method is needed.
 */

import { app, BrowserWindow, clipboard, shell } from 'electron';
import type { Result } from '../shared/ipc-contract.js';
import { getSettings } from './settings.js';
import { resolveSearchUrl } from './searchUrl.js';
import { PROTOCOL_SCHEME, NEW_INSTANCE_VERB } from './argv-parse.js';

// Re-export the pure resolver so callers/tests can reach it via the shell module.
export { resolveSearchUrl, templateForEngine } from './searchUrl.js';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ok(): Result<void> {
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
//  Shell channel implementations
// ---------------------------------------------------------------------------

/** Reveal `path` in the OS file manager with the file selected. */
export function openContainingFolder(path: string): Result<void> {
  try {
    if (!path || path.length === 0) return { ok: false, error: 'No file path' };
    shell.showItemInFolder(path);
    return ok();
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/** Copy an absolute file path to the clipboard (UWP "Copy full path"). */
export function copyPath(path: string): Result<void> {
  try {
    if (!path || path.length === 0) return { ok: false, error: 'No file path' };
    clipboard.writeText(path);
    return ok();
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Resolve a query to a search/URL and open it in the default browser. Resolution
 * uses the user's configured engine + custom URL from settings. A query that
 * resolves to `null` is a silent success (no-op), matching the UWP swallow.
 */
export async function webSearch(query: string): Promise<Result<void>> {
  try {
    const settingsResult = await getSettings();
    if (!settingsResult.ok) return settingsResult;
    const { searchEngine, customSearchUrl } = settingsResult.data;

    const url = resolveSearchUrl(query, searchEngine, customSearchUrl);
    if (url === null) return ok(); // nothing launchable — silent no-op.

    await shell.openExternal(url);
    return ok();
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Print the focused window's current document. The renderer has already laid out
 * the printable DOM (current tab for Ctrl+P / all tabs for Ctrl+Shift+P) before
 * calling this, so MAIN prints whatever is visible. Resolves only after the print
 * dialog flow completes (or is cancelled — cancellation is NOT an error).
 */
export function print(): Promise<Result<void>> {
  return new Promise((resolve) => {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (!win) {
        resolve({ ok: false, error: 'No window to print' });
        return;
      }
      win.webContents.print({}, (success, failureReason) => {
        // Electron reports `success:false` for a user cancel as well as a real
        // failure. A cancel carries the 'cancelled' reason; treat it as success
        // so the renderer doesn't surface an error for a deliberate dismiss.
        if (success || failureReason === 'cancelled' || failureReason === 'Print job canceled') {
          resolve(ok());
        } else {
          resolve({ ok: false, error: failureReason || 'Print failed' });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: errMsg(e) });
    }
  });
}

/**
 * Share `title` + `text`. Electron MAIN has no cross-platform programmatic share
 * sheet, so we fall back to the clipboard: the user keeps the content and can
 * paste it into any target. (UWP DataTransferManager parity is best-effort.)
 */
export function share(args: { title: string; text: string }): Result<void> {
  try {
    const title = args?.title ?? '';
    const text = args?.text ?? '';
    const payload = title.length > 0 ? `${title}\n\n${text}` : text;
    clipboard.writeText(payload);
    return ok();
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Jump-list / Recents registration. Called by MAIN's file-open path on every
 * successful open so the OS surfaces recently used files (UWP JumpListService).
 * Best-effort: failures are swallowed (a missing jump list must never break open).
 */
export function addRecentDocument(path: string): void {
  try {
    if (path && path.length > 0) app.addRecentDocument(path);
  } catch {
    // Jump list is a nicety; never let it surface.
  }
}

/**
 * Register the Windows Jump List "New window" task (UWP JumpListService added a
 * `notepads://newinstance` task alongside the Recents group). Launches this exe
 * with the protocol newinstance URL, which the broker parses to spawn a fresh
 * window. Best-effort + win32-only; failures are swallowed (the task is a nicety).
 * Call once during MAIN init.
 */
export function initJumpListTasks(): void {
  if (process.platform !== 'win32') return;
  try {
    app.setUserTasks([
      {
        program: process.execPath,
        arguments: `${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}`,
        title: 'New window',
        description: 'Open a new Notepads window',
        iconPath: process.execPath,
        iconIndex: 0
      }
    ]);
  } catch {
    // User tasks are a nicety; never let a failure surface.
  }
}
