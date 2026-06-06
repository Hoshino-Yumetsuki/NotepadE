/**
 * Canonical IPC channel names. Used ONLY by MAIN (ipcMain.handle) and PRELOAD
 * (ipcRenderer.invoke inside the contextBridge). The RENDERER never sees these
 * strings — it calls the typed `window.notepads` methods exclusively (PA-8).
 *
 * Each renderer-callable method maps 1:1 to an `invoke` channel; each push event
 * maps to a `webContents.send` channel (the `EVT_*` entries).
 */
export const IpcChannels = {
  // file
  FileOpen: 'notepads:file:open',
  FileSave: 'notepads:file:save',
  FileSaveAs: 'notepads:file:saveAs',
  FileReloadFromDisk: 'notepads:file:reloadFromDisk',
  FileRevalidatePath: 'notepads:file:revalidatePath',

  // encoding
  EncodingListAnsi: 'notepads:encoding:listAnsi',
  EncodingDecodeWith: 'notepads:encoding:decodeWith',
  EncodingConvertEol: 'notepads:encoding:convertEol',

  // session
  SessionSnapshot: 'notepads:session:snapshot',
  SessionLoadLast: 'notepads:session:loadLast',
  SessionClearRecovered: 'notepads:session:clearRecovered',

  // settings
  SettingsGet: 'notepads:settings:get',
  SettingsSet: 'notepads:settings:set',

  // window
  WindowBrokerRequest: 'notepads:window:brokerRequest',
  WindowSetFullScreen: 'notepads:window:setFullScreen',
  WindowSetCompactOverlay: 'notepads:window:setCompactOverlay',
  WindowQuit: 'notepads:window:quit',

  // dragOut
  DragOutBegin: 'notepads:dragOut:begin',
  DragOutComplete: 'notepads:dragOut:complete',

  // shell
  ShellOpenContainingFolder: 'notepads:shell:openContainingFolder',
  ShellCopyPath: 'notepads:shell:copyPath',
  ShellWebSearch: 'notepads:shell:webSearch',
  ShellPrint: 'notepads:shell:print',
  ShellShare: 'notepads:shell:share',

  // theme
  ThemeGet: 'notepads:theme:get',

  // --- push events (main -> renderer) ---
  EvtEditorAdopt: 'notepads:evt:editor:adopt',
  EvtEditorRelease: 'notepads:evt:editor:release',
  EvtThemeOsChanged: 'notepads:evt:theme:osChanged',
  EvtThemeAccentChanged: 'notepads:evt:theme:accentChanged',
  EvtSettingsChanged: 'notepads:evt:settings:changed',
  EvtAppActivation: 'notepads:evt:app:activation',
  EvtAppProtocol: 'notepads:evt:app:protocol',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
