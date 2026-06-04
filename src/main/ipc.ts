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
  DragEnvelope,
} from '../shared/ipc-contract.js';
import {
  openFile,
  saveFile,
  saveFileAs,
  reloadFromDisk,
  revalidatePath,
  decodeWithEncoding,
} from './file-io.js';
import { listAnsiEncodings } from './encoding.js';
import { applyEol } from './eol.js';
import { snapshot, loadLast, clearRecovered } from './session.js';
import { getSettings, setSettings } from './settings.js';
import { getThemeState } from './theme.js';
import {
  windowBrokerRequest,
  windowSetFullScreen,
  windowSetCompactOverlay,
} from './window.js';
import { dragOutBegin, dragOutComplete } from './dragout.js';
import { openContainingFolder, copyPath, webSearch, print, share } from './shell.js';

export function registerIpcHandlers(): void {
  // --- file ---
  ipcMain.handle(IpcChannels.FileOpen, (_e, path: string) => openFile(path));
  ipcMain.handle(IpcChannels.FileSave, (_e, args: SaveArgs) => saveFile(args));
  ipcMain.handle(IpcChannels.FileSaveAs, (_e, args: SaveAsArgs) => saveFileAs(args));
  ipcMain.handle(IpcChannels.FileReloadFromDisk, (_e, path: string) => reloadFromDisk(path));
  ipcMain.handle(IpcChannels.FileRevalidatePath, (_e, path: string) => revalidatePath(path));

  // --- encoding ---
  ipcMain.handle(IpcChannels.EncodingListAnsi, () => ({ ok: true, data: listAnsiEncodings() }));
  ipcMain.handle(IpcChannels.EncodingDecodeWith, (_e, path: string, encodingId: EncodingId) =>
    decodeWithEncoding(path, encodingId),
  );
  ipcMain.handle(
    IpcChannels.EncodingConvertEol,
    (_e, text: string, eolId: EolId): Result<string> => ({
      ok: true,
      data: applyEol(text, eolId),
    }),
  );

  // --- session (Phase 4) ---
  ipcMain.handle(IpcChannels.SessionSnapshot, (_e, data: SessionSnapshot) => snapshot(data));
  ipcMain.handle(IpcChannels.SessionLoadLast, () => loadLast());
  ipcMain.handle(IpcChannels.SessionClearRecovered, () => clearRecovered());

  // --- settings (Phase 5) ---
  ipcMain.handle(IpcChannels.SettingsGet, () => getSettings());
  ipcMain.handle(IpcChannels.SettingsSet, (_e, patch: Partial<Settings>) => setSettings(patch));

  // --- window (Phase 6) ---
  ipcMain.handle(
    IpcChannels.WindowBrokerRequest,
    (_e, args: { paths: string[]; forceNewWindow?: boolean }) => windowBrokerRequest(args),
  );
  ipcMain.handle(IpcChannels.WindowSetFullScreen, (e, enabled: boolean) =>
    windowSetFullScreen(e, enabled),
  );
  ipcMain.handle(IpcChannels.WindowSetCompactOverlay, (e, enabled: boolean) =>
    windowSetCompactOverlay(e, enabled),
  );

  // --- dragOut (Phase 6) ---
  ipcMain.handle(IpcChannels.DragOutBegin, (e, envelope: DragEnvelope) =>
    dragOutBegin(e, envelope),
  );
  ipcMain.handle(IpcChannels.DragOutComplete, (e, token: string, dropIndex: number) =>
    dragOutComplete(e, token, dropIndex),
  );

  // --- shell (Phase 6) ---
  ipcMain.handle(IpcChannels.ShellOpenContainingFolder, (_e, path: string) =>
    openContainingFolder(path),
  );
  ipcMain.handle(IpcChannels.ShellCopyPath, (_e, path: string) => copyPath(path));
  ipcMain.handle(IpcChannels.ShellWebSearch, (_e, query: string) => webSearch(query));
  ipcMain.handle(IpcChannels.ShellPrint, () => print());
  ipcMain.handle(IpcChannels.ShellShare, (_e, args: { title: string; text: string }) =>
    share(args),
  );

  // --- theme (Phase 5) ---
  ipcMain.handle(IpcChannels.ThemeGet, () => getThemeState());
}
