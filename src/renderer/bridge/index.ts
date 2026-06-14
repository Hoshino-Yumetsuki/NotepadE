/**
 * ============================================================================
 *  window.notepads bridge — Tauri v2 shim (replaces Electron preload)
 * ============================================================================
 *
 * Implements the EXACT window.notepads contract (src/shared/ipc-contract.ts)
 * over @tauri-apps/api invoke/listen. Each method maps to its Tauri snake_case
 * Rust command; each onX subscription maps to a Tauri event listener.
 *
 * Installed onto window.notepads BEFORE React mounts (src/renderer/main.tsx),
 * GUARDED: only when '__TAURI_INTERNALS__' is in window — vitest/jsdom keeps
 * using its test mocks, and this bridge never activates there.
 *
 * PA-8: this is the ONLY renderer file that imports @tauri-apps/api. Every
 * other renderer file calls window.notepads exclusively.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type {
  NotepadsApi,
  Result,
  SaveArgs,
  SaveAsArgs,
  SessionSnapshot,
  DragEnvelope,
  Settings,
  ActivationEvent,
  AnsiEncodingEntry,
  OpenedFile,
  SaveResult,
  RecentEntry,
  ThemeState,
  WallpaperState,
  AdoptPayload,
  UpdateInfo,
  Unsubscribe
} from '@shared/ipc-contract';

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an Electron IPC channel name (e.g. 'notepads:file:open') to its
 * Tauri snake_case command name (e.g. 'file_open').
 *
 * Algorithm:
 *   1. Strip the 'notepads:' prefix.
 *   2. Replace ':' with '_'.
 *   3. Convert camelCase to snake_case.
 */
function channelToCommand(channel: string): string {
  const stripped = channel.startsWith('notepads:') ? channel.slice('notepads:'.length) : channel;
  return stripped.replace(/:/g, '_').replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}

/**
 * Invoke a Tauri command and return the Result<T> envelope.
 * Rust commands return NpResult<T> = {ok,data|error} — Tauri deserialises it
 * verbatim; we just forward the typed promise.
 */
function call<T>(cmd: string, args?: Record<string, unknown>): Promise<Result<T>> {
  return invoke<Result<T>>(cmd, args);
}

/**
 * Subscribe to a Tauri event. Returns a synchronous Unsubscribe closure
 * (contract-conformant) that calls the async unlisten once it resolves.
 *
 * The electron preload's subscribe was synchronous (ipcRenderer.on returns
 * immediately). Tauri's listen() returns a Promise<UnlistenFn>, so we eagerly
 * start listening and store the resolved unlisten fn. The returned closer is
 * safe to call before the promise resolves (it's a no-op).
 */
function subscribe<T>(eventName: string, cb: (payload: T) => void): Unsubscribe {
  let unlisten: UnlistenFn | null = null;
  let done = false;

  listen<T>(eventName, (evt) => {
    cb(evt.payload);
  }).then((fn) => {
    if (done) {
      fn();
    } else {
      unlisten = fn;
    }
  });

  return () => {
    done = true;
    unlisten?.();
  };
}

// ---------------------------------------------------------------------------
//  Channel constants — exact strings from src/shared/ipc-channels.ts
//  (duplicated here so the bridge has zero dependencies on the Electron side)
// ---------------------------------------------------------------------------

const C = {
  // file
  FileOpen: 'notepads:file:open',
  FileOpenDialog: 'notepads:file:openDialog',
  FileSave: 'notepads:file:save',
  FileSaveAs: 'notepads:file:saveAs',
  FileReloadFromDisk: 'notepads:file:reloadFromDisk',
  FileRevalidatePath: 'notepads:file:revalidatePath',
  // recent
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
  SettingsResetAll: 'notepads:settings:resetAll',
  // window
  WindowBrokerRequest: 'notepads:window:brokerRequest',
WindowMinimize: 'notepads:window:minimize',
  WindowToggleMaximize: 'notepads:window:toggleMaximize',
  WindowClose: 'notepads:window:close',
  WindowIsMaximized: 'notepads:window:isMaximized',
  WindowQuit: 'notepads:window:quit',
  WindowConfirmClose: 'notepads:window:confirmClose',
  // dragOut
  DragOutBegin: 'notepads:dragOut:begin',
  DragOutComplete: 'notepads:dragOut:complete',
  // shell
  ShellOpenContainingFolder: 'notepads:shell:openContainingFolder',
  ShellCopyPath: 'notepads:shell:copyPath',
  ShellWebSearch: 'notepads:shell:webSearch',
  ShellShare: 'notepads:shell:share',
  // theme
  ThemeGet: 'notepads:theme:get',
  // wallpaper
  WallpaperGet: 'notepads:wallpaper:get',
  WallpaperSetFromPath: 'notepads:wallpaper:setFromPath',
  WallpaperSetFromUrl: 'notepads:wallpaper:setFromUrl',
  WallpaperPick: 'notepads:wallpaper:pick',
  WallpaperClear: 'notepads:wallpaper:clear',
  // updater
  UpdateCheck: 'notepads:update:check',
  UpdateInstall: 'notepads:update:install',
  // push events
  EvtEditorAdopt: 'notepads:evt:editor:adopt',
  EvtEditorRelease: 'notepads:evt:editor:release',
  EvtThemeOsChanged: 'notepads:evt:theme:osChanged',
  EvtThemeAccentChanged: 'notepads:evt:theme:accentChanged',
  EvtSettingsChanged: 'notepads:evt:settings:changed',
  EvtAppActivation: 'notepads:evt:app:activation',
  EvtAppProtocol: 'notepads:evt:app:protocol',
  // window push events (keep full Electron names as Tauri event names)
  WindowMaximizeChanged: 'notepads:window:maximizeChanged',
  EvtWindowCloseRequested: 'notepads:evt:window:closeRequested'
};

// ---------------------------------------------------------------------------
//  Cold-start activation buffer
// ---------------------------------------------------------------------------
// The broker flushes queued activations the moment the renderer emits
// `notepads:renderer:ready` (main.tsx), but App.tsx only subscribes via
// app.onActivation AFTER React mounts — and Tauri events with no registered
// listener are dropped. Listen eagerly at bridge install and buffer events
// until the app subscribes, so cold-start file-association opens are never
// lost. installBridge() resolves once this listener is registered; main.tsx
// awaits it BEFORE emitting renderer-ready.

let activationSink: ((event: ActivationEvent) => void) | null = null;
const bufferedActivations: ActivationEvent[] = [];

function installActivationBuffer(): Promise<void> {
  return listen<ActivationEvent>(C.EvtAppActivation, (evt) => {
    if (activationSink) activationSink(evt.payload);
    else bufferedActivations.push(evt.payload);
  }).then(() => undefined);
}

// ---------------------------------------------------------------------------
//  API implementation
// ---------------------------------------------------------------------------

const api: NotepadsApi = {
  file: {
    open: (path) => call<OpenedFile>(channelToCommand(C.FileOpen), { path }),
    openDialog: () => call<string[]>(channelToCommand(C.FileOpenDialog)),
    save: (args: SaveArgs) => call<SaveResult>(channelToCommand(C.FileSave), { args }),
    saveAs: (args: SaveAsArgs) => call<SaveResult>(channelToCommand(C.FileSaveAs), { args }),
    reloadFromDisk: (path) => call<OpenedFile>(channelToCommand(C.FileReloadFromDisk), { path }),
    revalidatePath: (path) =>
      call<{ exists: boolean; dateModifiedMs: number }>(channelToCommand(C.FileRevalidatePath), { path }),
    getSize: (path) => call<number>('file_get_size', { path }),
    openStreamed: (path) => call<import('@shared/ipc-contract').StreamedFileHeader>('file_open_streamed', { path }),
    onChunk: async (cb) => {
      const unlisten = await listen<import('@shared/ipc-contract').FileChunk>('notepads:evt:file:chunk', (evt) => {
        cb(evt.payload);
      });
      return unlisten;
    }
  },
  recent: {
    list: () => call<RecentEntry[]>(channelToCommand(C.RecentList)),
    clear: () => call<void>(channelToCommand(C.RecentClear))
  },
  paths: {
    /**
     * No webview equivalent for electron's webUtils.getPathForFile.
     * Drop handling moves to Tauri's native onDragDropEvent which provides
     * absolute paths directly — this method stays inert (returns '').
     */
    forFile: (_file: File) => ''
  },
  encoding: {
    listAnsi: () => call<AnsiEncodingEntry[]>(channelToCommand(C.EncodingListAnsi)),
    decodeWith: (path, encodingId) =>
      call<OpenedFile>(channelToCommand(C.EncodingDecodeWith), { path, encodingId }),
    convertEol: (text, eolId) =>
      call<string>(channelToCommand(C.EncodingConvertEol), { text, eolId })
  },
  hash: {
    compute: (text) => call<number>('compute_text_hash', { text })
  },
  diff: {
    compute: (original, modified) => call<import('@shared/ipc-contract').DiffModelDto>('compute_diff', { original, modified })
  },
  session: {
    snapshot: (data: SessionSnapshot) =>
      call<{ written: boolean }>(channelToCommand(C.SessionSnapshot), { data } as unknown as Record<string, unknown>),
    loadLast: () => call<SessionSnapshot | null>(channelToCommand(C.SessionLoadLast)),
    clearRecovered: () => call<void>(channelToCommand(C.SessionClearRecovered))
  },
  settings: {
    get: () => call<Settings>(channelToCommand(C.SettingsGet)),
    set: (patch: Partial<Settings>) =>
      call<Settings>(channelToCommand(C.SettingsSet), { patch } as unknown as Record<string, unknown>),
    resetAll: () => call<Settings>(channelToCommand(C.SettingsResetAll)),
    onChanged: (cb) => subscribe<Settings>(C.EvtSettingsChanged, cb)
  },
  window: {
    brokerRequest: (args) =>
      call<void>(channelToCommand(C.WindowBrokerRequest), { args }),
    minimize: () => call<void>(channelToCommand(C.WindowMinimize)),
    toggleMaximize: () => call<{ isMaximized: boolean }>(channelToCommand(C.WindowToggleMaximize)),
    close: () => call<void>(channelToCommand(C.WindowClose)),
    isMaximized: () => call<{ isMaximized: boolean }>(channelToCommand(C.WindowIsMaximized)),
    onMaximizeChanged: (cb) => subscribe<boolean>(C.WindowMaximizeChanged, cb),
    quit: () => call<void>(channelToCommand(C.WindowQuit)),
    confirmClose: () => call<void>(channelToCommand(C.WindowConfirmClose)),
    onCloseRequested: (cb) => subscribe<undefined>(C.EvtWindowCloseRequested, () => cb())
  },
  dragOut: {
    begin: (envelope: DragEnvelope) =>
      call<{ token: string }>(channelToCommand(C.DragOutBegin), { envelope } as unknown as Record<string, unknown>),
    complete: (token, dropIndex) =>
      call<void>(channelToCommand(C.DragOutComplete), { token, dropIndex })
  },
  editor: {
    onAdopt: (cb: (payload: AdoptPayload) => void) =>
      subscribe<AdoptPayload>(C.EvtEditorAdopt, cb),
    onRelease: (cb) => subscribe<{ editorId: string }>(C.EvtEditorRelease, cb)
  },
  theme: {
    get: () => call<ThemeState>(channelToCommand(C.ThemeGet)),
    onOsThemeChanged: (cb) => subscribe<'light' | 'dark'>(C.EvtThemeOsChanged, cb),
    onAccentChanged: (cb) => subscribe<string>(C.EvtThemeAccentChanged, cb)
  },
  app: {
    onActivation: (cb: (event: ActivationEvent) => void) => {
      // Drain anything that arrived before the app subscribed (cold start).
      activationSink = cb;
      while (bufferedActivations.length > 0) {
        cb(bufferedActivations.shift() as ActivationEvent);
      }
      return () => {
        if (activationSink === cb) activationSink = null;
      };
    },
    onProtocol: (cb) => subscribe<string>(C.EvtAppProtocol, cb)
  },
  shell: {
    openContainingFolder: (path) =>
      call<void>(channelToCommand(C.ShellOpenContainingFolder), { path }),
    copyPath: (path) => call<void>(channelToCommand(C.ShellCopyPath), { path }),
    webSearch: (query) => call<void>(channelToCommand(C.ShellWebSearch), { query }),
    /**
     * shell.print: implement as window.print() — no Tauri command needed.
     * Resolves with {ok:true, data:undefined} per the Result envelope contract.
     */
    print: async () => {
      window.print();
      return { ok: true as const, data: undefined };
    },
    share: (args) => call<void>(channelToCommand(C.ShellShare), { args })
  },
  wallpaper: {
    get: () => call<WallpaperState>(channelToCommand(C.WallpaperGet)),
    setFromPath: (path) => call<WallpaperState>(channelToCommand(C.WallpaperSetFromPath), { path }),
    setFromUrl: (url) => call<WallpaperState>(channelToCommand(C.WallpaperSetFromUrl), { url }),
    pick: () => call<WallpaperState | null>(channelToCommand(C.WallpaperPick)),
    clear: () => call<void>(channelToCommand(C.WallpaperClear))
  },
  updates: {
    check: () => call<UpdateInfo>(channelToCommand(C.UpdateCheck)),
    install: (assetUrl, assetName, htmlUrl) =>
      call<void>(channelToCommand(C.UpdateInstall), { assetUrl, assetName, htmlUrl })
  }
};

// ---------------------------------------------------------------------------
//  Install
// ---------------------------------------------------------------------------

/**
 * Install the bridge onto window.notepads. Must be called BEFORE React mounts
 * (from src/renderer/main.tsx) so every renderer consumer sees the live API.
 *
 * Resolves once the eager activation listener is registered — the caller must
 * await this BEFORE emitting `notepads:renderer:ready`, otherwise the broker
 * may flush cold-start activations into a window with no listener yet.
 *
 * Guarded by '__TAURI_INTERNALS__' check in the caller — this function assumes
 * it only runs inside a Tauri webview.
 */
export function installBridge(): Promise<void> {
  (window as unknown as Record<string, unknown>).notepads = Object.freeze(api);

  // Wire Tauri drag region manually — the `data-tauri-drag-region` attribute
  // depends on Tauri's core init which may not have set up the delegated
  // listener yet (or was missed with the CSP / module load order).
  setupTauriDragRegion();

  return installActivationBuffer();
}

/**
 * Delegated pointerdown listener: if the event target (or any ancestor)
 * carries `data-tauri-drag-region`, call `startDragging()`. Interactive
 * controls (buttons, inputs, tabs, menus) are excluded so clicks still work.
 */
function setupTauriDragRegion(): void {
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    document.addEventListener('pointerdown', (e) => {
      // Walk up from the event target looking for a drag-region ancestor.
      let el: HTMLElement | null = e.target as HTMLElement;
      while (el) {
        if (el.hasAttribute?.('data-tauri-drag-region')) {
          // If the click landed on an interactive control (or a child of one,
          // e.g. an SVG icon inside a button), let the click through — don't
          // start a drag.
          if (isInteractive(e.target as HTMLElement)) return;
          e.preventDefault();
          getCurrentWindow().startDragging();
          return;
        }
        el = el.parentElement;
      }
    });
  });
}

/** True when the element (or any ancestor) is an interactive control whose
 *  clicks should never start a window drag. */
function isInteractive(target: HTMLElement): boolean {
  const INTERACTIVE_TAGS = new Set([
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'OPTION',
    'DETAILS', 'SUMMARY', 'VIDEO', 'AUDIO', 'LABEL'
  ]);
  if (INTERACTIVE_TAGS.has(target.tagName)) return true;
  // Also check ancestors: a click on an SVG icon inside a <button> still
  // needs to reach the button, not start a drag.
  return target.closest(
    'button, input, select, textarea, a, [role="tab"], [role="menuitem"], [role="button"], [role="menu"], [role="menubar"]'
  ) !== null;
}
