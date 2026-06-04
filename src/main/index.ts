/**
 * MAIN process entry — Notepads-next walking skeleton.
 *
 * Owns ALL fs/dialog/path/encoding (PA-8). Boots one hardened BrowserWindow,
 * registers the typed IPC handlers, loads the renderer.
 */

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMainWindow } from './window-factory.js';
import { registerIpcHandlers } from './ipc.js';
import { initThemePush } from './theme.js';
import {
  acquireSingleInstance,
  registerProtocolClient,
  initBroker,
  processInitialActivation,
  flushPendingActivation,
} from './broker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRenderer(win: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/** Create a fresh window and load the renderer into it. The broker's spawn fn. */
function spawnWindow(): BrowserWindow {
  const win = createMainWindow();
  loadRenderer(win);
  return win;
}

/**
 * One-time process init: IPC handlers, theme push, broker. Separated from the
 * per-window spawn so `activate` (macOS dock re-open) can recreate a window
 * WITHOUT re-registering handlers or re-initializing the broker.
 */
function initOnce(): void {
  registerIpcHandlers();
  initThemePush();
  initBroker(spawnWindow);
}

function bootstrap(): void {
  initOnce();
  spawnWindow();
  // Deliver any cold-start file/protocol activation once the first window exists.
  processInitialActivation();
  flushPendingActivation();
}

/**
 * Honor the deterministic e2e userData override BEFORE `app.whenReady()` so the
 * session manager and Electron agree on a single root. The Playwright harness
 * (e2e/helpers/launch.ts) exports NOTEPADS_E2E_USERDATA to drive kill→restart
 * session-parity against the same NotepadsSessionData.json + BackupFiles/.
 */
function applyE2eUserDataOverride(): void {
  const override = process.env['NOTEPADS_E2E_USERDATA'];
  if (override && override.length > 0) {
    app.setPath('userData', override);
  }
}

applyE2eUserDataOverride();

/**
 * Single-instance lock: the first process becomes the broker; a later launch
 * forwards its argv via 'second-instance' and quits. Skipped under the e2e
 * harness, where each Playwright spec is its own isolated process (the lock
 * would otherwise race across the rapid launch/teardown cycle) and the two-
 * window transfer is exercised by spawning within a single process.
 */
const isE2e = process.env['NOTEPADS_E2E'] === '1';
const isPrimary = isE2e ? true : acquireSingleInstance();

if (isPrimary) {
  registerProtocolClient();

  app.whenReady().then(() => {
    bootstrap();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        spawnWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
