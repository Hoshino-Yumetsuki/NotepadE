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

app.whenReady().then(() => {
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
