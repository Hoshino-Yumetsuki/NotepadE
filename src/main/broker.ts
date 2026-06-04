/**
 * Broker — MAIN only (Phase 6, Workstream 6.A).
 *
 * The single-instance coordinator + activation router. Replaces the UWP
 * App.xaml.cs activation surface (OnActivated / OnFileActivated /
 * second-instance redirect, NotepadsProtocolService) with the Electron model:
 *
 *   - Electron's single-instance lock makes the FIRST process the broker; any
 *     later launch hands its argv+cwd to the primary via the 'second-instance'
 *     event and then quits (UWP's RedirectActivationTo).
 *   - On Windows, file/protocol activation arrives as extra argv on the primary's
 *     'second-instance' (NOT macOS 'open-url'/'open-file'), so we parse paths and
 *     the `notepads://` protocol url out of argv against the captured cwd.
 *   - Redirect-vs-spawn honors settings.alwaysOpenNewWindow (read from the
 *     Phase-5 MAIN settings store): false → redirect into the focused window;
 *     true → spawn a fresh window. The `newinstance` protocol verb always spawns.
 *
 * MAIN is the sole owner of fs/argv/protocol (PA-8). Activation is delivered to
 * the renderer as the typed `EvtAppActivation` / `EvtAppProtocol` push events.
 */

import { app, BrowserWindow } from 'electron';
import { resolve, isAbsolute } from 'node:path';
import type { ActivationEvent } from '../shared/ipc-contract.js';
import { IpcChannels } from '../shared/ipc-channels.js';
import { getSettings } from './settings.js';

/** The `notepads://` custom protocol scheme (UWP NotepadsProtocolService). */
const PROTOCOL_SCHEME = 'notepads';
/** Protocol verb that always forces a new instance/window. */
const NEW_INSTANCE_VERB = 'newinstance';

/** How the broker spawns a new window. Injected so index.ts owns window-factory. */
type SpawnWindow = () => BrowserWindow;

let spawnWindow: SpawnWindow | null = null;

/** The window the broker last saw focused (UWP active-window tracking). */
let lastFocusedWindow: BrowserWindow | null = null;

/**
 * True when an activation arrived before any window finished loading; the
 * pending activation is flushed once a renderer signals it is ready (so the very
 * first file-open on a cold launch is not dropped). Keyed nowhere — at most one
 * cold-start activation is meaningful.
 */
let pendingActivation: ActivationEvent | null = null;

/** Track focus so redirect targets the window the user last used. */
function trackFocus(): void {
  app.on('browser-window-focus', (_e, win) => {
    lastFocusedWindow = win;
  });
  app.on('browser-window-blur', () => {
    // Keep lastFocusedWindow as the most-recent; do not null on blur.
  });
}

/** Resolve a single argv token to an absolute path against `cwd`. */
function resolveArg(token: string, cwd: string): string {
  return isAbsolute(token) ? token : resolve(cwd, token);
}

/**
 * Parse an argv array into file paths + an optional `notepads://` url. The first
 * element is the executable (and, in dev, the script) — we skip electron's own
 * switches (leading '-') and the app path, keeping bare tokens as candidate
 * paths. A token matching the protocol scheme is captured as the protocol url.
 */
function parseArgv(argv: readonly string[], cwd: string): { paths: string[]; protocolUrl: string | null } {
  const paths: string[] = [];
  let protocolUrl: string | null = null;
  for (const token of argv) {
    if (!token || token.startsWith('-')) continue;
    if (token.startsWith(`${PROTOCOL_SCHEME}://`)) {
      protocolUrl = token;
      continue;
    }
    // Skip the electron executable and the bundled main entry on cold start.
    if (token === process.execPath) continue;
    if (token.endsWith('.js') || token.endsWith('.cjs') || token.endsWith('.mjs')) continue;
    if (token === '.' || token === app.getAppPath()) continue;
    paths.push(resolveArg(token, cwd));
  }
  return { paths, protocolUrl };
}

/** Does the protocol url request a brand-new instance (the `newinstance` verb)? */
function isNewInstanceProtocol(protocolUrl: string | null): boolean {
  if (!protocolUrl) return false;
  const rest = protocolUrl.slice(`${PROTOCOL_SCHEME}://`.length).replace(/\/+$/, '');
  return rest.toLowerCase() === NEW_INSTANCE_VERB;
}

/** Pick the redirect target: the last-focused live window, else any live one. */
function redirectTarget(): BrowserWindow | null {
  if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) return lastFocusedWindow;
  const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  return all.length > 0 ? all[all.length - 1] : null;
}

/** Send the activation push to a specific window's renderer. */
function deliver(win: BrowserWindow, event: ActivationEvent): void {
  if (win.isDestroyed()) return;
  const send = (): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(IpcChannels.EvtAppActivation, event);
    if (event.protocolUrl) {
      win.webContents.send(IpcChannels.EvtAppProtocol, event.protocolUrl);
    }
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

/**
 * Route an activation: spawn a new window when alwaysOpenNewWindow is set or the
 * protocol asked for a new instance; otherwise redirect into the focused window
 * (spawning one if none exist yet). The activation event is then delivered to
 * the chosen window's renderer.
 */
async function routeActivation(event: ActivationEvent): Promise<void> {
  if (!spawnWindow) {
    // No window factory yet (pre-bootstrap); stash for the cold-start flush.
    pendingActivation = event;
    return;
  }

  const settings = await getSettings();
  const alwaysNew = settings.ok ? settings.data.alwaysOpenNewWindow : false;
  const forceNew = alwaysNew || isNewInstanceProtocol(event.protocolUrl);

  const target = forceNew ? spawnWindow() : (redirectTarget() ?? spawnWindow());
  if (forceNew && !target.isDestroyed()) target.focus();
  deliver(target, event);
}

/**
 * Acquire the single-instance lock and wire activation. Returns false when this
 * process is a SECONDARY instance (the caller must quit immediately — its argv
 * has already been forwarded to the primary). Returns true for the primary.
 */
export function acquireSingleInstance(): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (_event, argv, cwd) => {
    const parsed = parseArgv(argv, cwd);
    void routeActivation({ paths: parsed.paths, cwd, protocolUrl: parsed.protocolUrl });
  });

  return true;
}

/**
 * Register the `notepads://` protocol client so OS-level protocol launches reach
 * this app. In dev (no packaged exe) Electron needs the exec path + the script
 * path as extra args, mirroring electron-builder's installed registration.
 */
export function registerProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
  }
}

/**
 * Initialize the broker: focus tracking + the macOS open-file/open-url handlers
 * (Windows routes these through 'second-instance' argv instead). `spawn` is the
 * window factory the broker uses for spawn-vs-redirect. Call once at startup,
 * after the window factory is available.
 */
export function initBroker(spawn: SpawnWindow): void {
  spawnWindow = spawn;
  trackFocus();

  // macOS-only activation channels (no-ops on win32/linux).
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void routeActivation({ paths: [filePath], cwd: process.cwd(), protocolUrl: null });
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void routeActivation({ paths: [], cwd: process.cwd(), protocolUrl: url });
  });
}

/**
 * Process this process's OWN initial argv (cold launch with file/protocol args).
 * Delivered to the first window once it exists. Call after the initial window is
 * created so redirect has a target.
 */
export function processInitialActivation(): void {
  const parsed = parseArgv(process.argv, process.cwd());
  if (parsed.paths.length === 0 && parsed.protocolUrl === null) return;
  void routeActivation({ paths: parsed.paths, cwd: process.cwd(), protocolUrl: parsed.protocolUrl });
}

/**
 * Programmatic broker entry for the renderer's WindowApi.brokerRequest. Routes
 * the requested paths through the SAME spawn-vs-redirect logic as an OS
 * activation; `forceNewWindow` maps to the protocol `newinstance` semantics.
 */
export async function brokerRequest(paths: string[], forceNewWindow: boolean): Promise<void> {
  await routeActivation({
    paths,
    cwd: process.cwd(),
    protocolUrl: forceNewWindow ? `${PROTOCOL_SCHEME}://${NEW_INSTANCE_VERB}` : null,
  });
}

/**
 * Flush any activation that arrived before the window factory was ready. Called
 * once from bootstrap after the first window exists.
 */
export function flushPendingActivation(): void {
  if (pendingActivation && spawnWindow) {
    const ev = pendingActivation;
    pendingActivation = null;
    void routeActivation(ev);
  }
}
