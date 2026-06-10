/**
 * IPC handler registration — MAIN. Each renderer-callable method maps 1:1 to an
 * ipcMain.handle channel. Implemented: file.open / file.save / file.* and the
 * full encoding namespace (listAnsi / decodeWith / convertEol). Remaining
 * channels (session / window / dragOut / shell / theme) are registered as typed
 * stubs returning a not-implemented error so the contract surface stays complete
 * and callable.
 */

import { ipcMain } from 'electron';
import { IpcChannels } from '../shared/ipc-channels.js';
import type {
  Result,
  SaveArgs,
  SaveAsArgs,
  EncodingId,
  EolId,
  SessionSnapshot,
  Settings,
  DragEnvelope
} from '../shared/ipc-contract.js';
import {
  openFile,
  openFileDialog,
  saveFile,
  saveFileAs,
  reloadFromDisk,
  revalidatePath,
  decodeWithEncoding
} from './file-io.js';
import { listRecentResult, clearRecent } from './mru.js';
import { listAnsiEncodings } from './encoding.js';
import { applyEol } from './eol.js';
import { snapshot, loadLast, clearRecovered } from './session.js';
import { getSettings, setSettings } from './settings.js';
import { resetAllSettings } from './settings-reset.js';
import { getThemeState } from './theme.js';
import {
  windowBrokerRequest,
  windowSetFullScreen,
  windowSetCompactOverlay,
  windowMinimize,
  windowToggleMaximize,
  windowClose,
  windowIsMaximized,
  windowQuit,
  windowConfirmClose
} from './window.js';
import { dragOutBegin, dragOutComplete } from './dragout.js';
import { openContainingFolder, copyPath, webSearch, print, share } from './shell.js';
import {
  getWallpaper,
  setWallpaperFromPath,
  setWallpaperFromUrl,
  pickWallpaper,
  clearWallpaper
} from './wallpaper.js';

export function registerIpcHandlers(): void {
  // --- file ---
  ipcMain.handle(IpcChannels.FileOpen, (_e, path: string) => openFile(path));
  ipcMain.handle(IpcChannels.FileOpenDialog, () => openFileDialog());
  ipcMain.handle(IpcChannels.FileSave, (_e, args: SaveArgs) => saveFile(args));
  ipcMain.handle(IpcChannels.FileSaveAs, (_e, args: SaveAsArgs) => saveFileAs(args));
  ipcMain.handle(IpcChannels.FileReloadFromDisk, (_e, path: string) => reloadFromDisk(path));
  ipcMain.handle(IpcChannels.FileRevalidatePath, (_e, path: string) => revalidatePath(path));

  // --- recent (in-app MRU; distinct from the OS jump list) ---
  ipcMain.handle(IpcChannels.RecentList, () => listRecentResult());
  ipcMain.handle(IpcChannels.RecentClear, () => clearRecent());

  // --- encoding ---
  ipcMain.handle(IpcChannels.EncodingListAnsi, () => ({ ok: true, data: listAnsiEncodings() }));
  ipcMain.handle(IpcChannels.EncodingDecodeWith, (_e, path: string, encodingId: EncodingId) =>
    decodeWithEncoding(path, encodingId)
  );
  ipcMain.handle(
    IpcChannels.EncodingConvertEol,
    (_e, text: string, eolId: EolId): Result<string> => ({
      ok: true,
      data: applyEol(text, eolId)
    })
  );

  // --- session (Phase 4) ---
  ipcMain.handle(IpcChannels.SessionSnapshot, (_e, data: SessionSnapshot) => snapshot(data));
  ipcMain.handle(IpcChannels.SessionLoadLast, () => loadLast());
  ipcMain.handle(IpcChannels.SessionClearRecovered, () => clearRecovered());

  // --- settings (Phase 5) ---
  ipcMain.handle(IpcChannels.SettingsGet, () => getSettings());
  ipcMain.handle(IpcChannels.SettingsSet, (_e, patch: Partial<Settings>) => setSettings(patch));
  // Factory reset: wallpaper-file cleanup + full-defaults persist/broadcast.
  ipcMain.handle(IpcChannels.SettingsResetAll, () => resetAllSettings());

  // --- window (Phase 6) ---
  ipcMain.handle(
    IpcChannels.WindowBrokerRequest,
    (_e, args: { paths: string[]; forceNewWindow?: boolean }) => windowBrokerRequest(args)
  );
  ipcMain.handle(IpcChannels.WindowSetFullScreen, (e, enabled: boolean) =>
    windowSetFullScreen(e, enabled)
  );
  ipcMain.handle(IpcChannels.WindowSetCompactOverlay, (e, enabled: boolean) =>
    windowSetCompactOverlay(e, enabled)
  );
  // Custom caption controls (replace the OS titleBarOverlay — transparent buttons).
  ipcMain.handle(IpcChannels.WindowMinimize, (e) => windowMinimize(e));
  ipcMain.handle(IpcChannels.WindowToggleMaximize, (e) => windowToggleMaximize(e));
  ipcMain.handle(IpcChannels.WindowClose, (e) => windowClose(e));
  ipcMain.handle(IpcChannels.WindowIsMaximized, (e) => windowIsMaximized(e));
  ipcMain.handle(IpcChannels.WindowQuit, () => windowQuit());
  ipcMain.handle(IpcChannels.WindowConfirmClose, (e) => windowConfirmClose(e));

  // --- dragOut (Phase 6) ---
  ipcMain.handle(IpcChannels.DragOutBegin, (e, envelope: DragEnvelope) =>
    dragOutBegin(e, envelope)
  );
  ipcMain.handle(IpcChannels.DragOutComplete, (e, token: string, dropIndex: number) =>
    dragOutComplete(e, token, dropIndex)
  );

  // --- shell (Phase 6) ---
  ipcMain.handle(IpcChannels.ShellOpenContainingFolder, (_e, path: string) =>
    openContainingFolder(path)
  );
  ipcMain.handle(IpcChannels.ShellCopyPath, (_e, path: string) => copyPath(path));
  ipcMain.handle(IpcChannels.ShellWebSearch, (_e, query: string) => webSearch(query));
  ipcMain.handle(IpcChannels.ShellPrint, () => print());
  ipcMain.handle(IpcChannels.ShellShare, (_e, args: { title: string; text: string }) =>
    share(args)
  );

  // --- theme (Phase 5) ---
  ipcMain.handle(IpcChannels.ThemeGet, () => getThemeState());

  // --- wallpaper (custom background image; MAIN owns the managed folder) ---
  ipcMain.handle(IpcChannels.WallpaperGet, () => getWallpaper());
  ipcMain.handle(IpcChannels.WallpaperSetFromPath, (_e, path: string) =>
    setWallpaperFromPath(path)
  );
  ipcMain.handle(IpcChannels.WallpaperSetFromUrl, (_e, url: string) => setWallpaperFromUrl(url));
  ipcMain.handle(IpcChannels.WallpaperPick, () => pickWallpaper());
  ipcMain.handle(IpcChannels.WallpaperClear, () => clearWallpaper());
}
