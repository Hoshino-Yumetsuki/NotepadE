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
import type { Result, SaveArgs, SaveAsArgs, EncodingId, EolId } from '../shared/ipc-contract.js';
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

function notImplemented(channel: string): Result<never> {
  return { ok: false, error: `Not implemented in Phase 1: ${channel}` };
}

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
  ipcMain.handle(IpcChannels.SessionSnapshot, () => notImplemented(IpcChannels.SessionSnapshot));
  ipcMain.handle(IpcChannels.SessionLoadLast, () => notImplemented(IpcChannels.SessionLoadLast));
  ipcMain.handle(IpcChannels.SessionClearRecovered, () =>
    notImplemented(IpcChannels.SessionClearRecovered),
  );

  // --- window (Phase 6) ---
  ipcMain.handle(IpcChannels.WindowBrokerRequest, () =>
    notImplemented(IpcChannels.WindowBrokerRequest),
  );
  ipcMain.handle(IpcChannels.WindowSetFullScreen, () =>
    notImplemented(IpcChannels.WindowSetFullScreen),
  );
  ipcMain.handle(IpcChannels.WindowSetCompactOverlay, () =>
    notImplemented(IpcChannels.WindowSetCompactOverlay),
  );

  // --- dragOut (Phase 6) ---
  ipcMain.handle(IpcChannels.DragOutBegin, () => notImplemented(IpcChannels.DragOutBegin));
  ipcMain.handle(IpcChannels.DragOutComplete, () => notImplemented(IpcChannels.DragOutComplete));

  // --- shell (Phase 6) ---
  ipcMain.handle(IpcChannels.ShellOpenContainingFolder, () =>
    notImplemented(IpcChannels.ShellOpenContainingFolder),
  );
  ipcMain.handle(IpcChannels.ShellCopyPath, () => notImplemented(IpcChannels.ShellCopyPath));
  ipcMain.handle(IpcChannels.ShellWebSearch, () => notImplemented(IpcChannels.ShellWebSearch));
  ipcMain.handle(IpcChannels.ShellPrint, () => notImplemented(IpcChannels.ShellPrint));
  ipcMain.handle(IpcChannels.ShellShare, () => notImplemented(IpcChannels.ShellShare));

  // --- theme (Phase 5) ---
  ipcMain.handle(IpcChannels.ThemeGet, () => notImplemented(IpcChannels.ThemeGet));
}
