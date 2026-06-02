/**
 * PRELOAD — exposes exactly one frozen, typed `window.notepads` object via
 * contextBridge (PA-8). This is the SOLE IPC contract. No raw ipcRenderer is
 * exposed to the renderer; every method wraps ipcRenderer.invoke / .on here.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '../shared/ipc-channels.js';
import type {
  NotepadsApi,
  Result,
  SaveArgs,
  SaveAsArgs,
  SessionSnapshot,
  DragEnvelope,
  AdoptPayload,
  ThemeState,
  ActivationEvent,
  AnsiEncodingEntry,
  OpenedFile,
  SaveResult,
  EncodingId,
  EolId,
  Unsubscribe,
} from '../shared/ipc-contract.js';

function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>;
}

/** Subscribe to a main->renderer push channel; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: NotepadsApi = {
  file: {
    open: (path) => invoke<OpenedFile>(IpcChannels.FileOpen, path),
    save: (args: SaveArgs) => invoke<SaveResult>(IpcChannels.FileSave, args),
    saveAs: (args: SaveAsArgs) => invoke<SaveResult>(IpcChannels.FileSaveAs, args),
    reloadFromDisk: (path) => invoke<OpenedFile>(IpcChannels.FileReloadFromDisk, path),
    revalidatePath: (path) =>
      invoke<{ exists: boolean; dateModifiedMs: number }>(IpcChannels.FileRevalidatePath, path),
  },
  encoding: {
    listAnsi: () => invoke<AnsiEncodingEntry[]>(IpcChannels.EncodingListAnsi),
    decodeWith: (path, encodingId: EncodingId) =>
      invoke<OpenedFile>(IpcChannels.EncodingDecodeWith, path, encodingId),
    convertEol: (text, eolId: EolId) => invoke<string>(IpcChannels.EncodingConvertEol, text, eolId),
  },
  session: {
    snapshot: (data: SessionSnapshot) =>
      invoke<{ written: boolean }>(IpcChannels.SessionSnapshot, data),
    loadLast: () => invoke<SessionSnapshot | null>(IpcChannels.SessionLoadLast),
    clearRecovered: () => invoke<void>(IpcChannels.SessionClearRecovered),
  },
  window: {
    brokerRequest: (args) => invoke<void>(IpcChannels.WindowBrokerRequest, args),
    setFullScreen: (enabled) =>
      invoke<{ isFullScreen: boolean }>(IpcChannels.WindowSetFullScreen, enabled),
    setCompactOverlay: (enabled) =>
      invoke<{ isCompactOverlay: boolean }>(IpcChannels.WindowSetCompactOverlay, enabled),
  },
  dragOut: {
    begin: (envelope: DragEnvelope) =>
      invoke<{ token: string }>(IpcChannels.DragOutBegin, envelope),
    complete: (token, dropIndex) => invoke<void>(IpcChannels.DragOutComplete, token, dropIndex),
  },
  editor: {
    onAdopt: (cb: (payload: AdoptPayload) => void) =>
      subscribe<AdoptPayload>(IpcChannels.EvtEditorAdopt, cb),
    onRelease: (cb) => subscribe<{ editorId: string }>(IpcChannels.EvtEditorRelease, cb),
  },
  theme: {
    get: () => invoke<ThemeState>(IpcChannels.ThemeGet),
    onOsThemeChanged: (cb) => subscribe<'light' | 'dark'>(IpcChannels.EvtThemeOsChanged, cb),
    onAccentChanged: (cb) => subscribe<string>(IpcChannels.EvtThemeAccentChanged, cb),
  },
  app: {
    onActivation: (cb: (event: ActivationEvent) => void) =>
      subscribe<ActivationEvent>(IpcChannels.EvtAppActivation, cb),
    onProtocol: (cb) => subscribe<string>(IpcChannels.EvtAppProtocol, cb),
  },
  shell: {
    openContainingFolder: (path) => invoke<void>(IpcChannels.ShellOpenContainingFolder, path),
    copyPath: (path) => invoke<void>(IpcChannels.ShellCopyPath, path),
    webSearch: (query) => invoke<void>(IpcChannels.ShellWebSearch, query),
    print: () => invoke<void>(IpcChannels.ShellPrint),
    share: (args) => invoke<void>(IpcChannels.ShellShare, args),
  },
};

contextBridge.exposeInMainWorld('notepads', Object.freeze(api));
