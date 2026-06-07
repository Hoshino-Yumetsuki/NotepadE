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
  FileOpenDialog: 'notepads:file:openDialog',
  FileSave: 'notepads:file:save',
  FileSaveAs: 'notepads:file:saveAs',
  FileReloadFromDisk: 'notepads:file:reloadFromDisk',
  FileRevalidatePath: 'notepads:file:revalidatePath',

  // recent (in-app MRU; distinct from the OS jump list)
  RecentList: 'notepads:recent:list',
  RecentClear: 'notepads:recent:clear',

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
  // Custom caption controls (replaces the OS titleBarOverlay so the buttons are
  // transparent and the acrylic shows through — 1:1 with the UWP
  // ApplyThemeForTitleBarButtons transparent-button scheme).
  WindowMinimize: 'notepads:window:minimize',
  WindowToggleMaximize: 'notepads:window:toggleMaximize',
  WindowClose: 'notepads:window:close',
  WindowIsMaximized: 'notepads:window:isMaximized',
  /** MAIN→renderer push: window maximized state changed (drives the restore glyph). */
  WindowMaximizeChanged: 'notepads:window:maximizeChanged',
  WindowQuit: 'notepads:window:quit',
  /**
   * Renderer→MAIN: the renderer has resolved the close-reminder flow and the
   * window may now actually close (UWP MainPage_CloseRequested deferral.Complete).
   */
  WindowConfirmClose: 'notepads:window:confirmClose',
  /**
   * MAIN→renderer push: the user tried to close the window (X / Alt+F4 / OS). The
   * renderer runs the unsaved-changes flow, then calls WindowConfirmClose to let
   * the real close proceed (1:1 with the UWP SystemNavigationCloseRequested guard).
   */
  EvtWindowCloseRequested: 'notepads:evt:window:closeRequested',

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
