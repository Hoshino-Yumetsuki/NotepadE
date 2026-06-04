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

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function loadRenderer(win: BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function bootstrap(): void {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  loadRenderer(mainWindow);
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

app.whenReady().then(() => {
  initThemePush();
  bootstrap();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      bootstrap();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
