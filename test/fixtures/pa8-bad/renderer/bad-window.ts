// PA-8 FIXTURE — DELIBERATELY BAD. Must trip every PA-8 rule.
// Scanned only via `npm run pa8:scan:fixture` (--expect-fail). NEVER imported by the app.
//
// This file is the falsifiable proof that the PA-8 gate bites. If the scanner
// ever passes this file, the harness is broken (see scripts/pa8-scan.ts --expect-fail).

import { app, BrowserWindow } from 'electron';

// VIOLATION: fs/path/child_process imported in a renderer-rooted file.
import fs from 'fs';
import { join } from 'path';
import { exec } from 'child_process';

// VIOLATION: @electron/remote reference.
import remote from '@electron/remote';

// VIOLATION: raw ipcRenderer in renderer surface.
import { ipcRenderer } from 'electron';

export function createBadWindow(): BrowserWindow {
  const win = new BrowserWindow({
    webPreferences: {
      // VIOLATION: nodeIntegration must be false.
      nodeIntegration: true,
      // VIOLATION: contextIsolation must be true.
      contextIsolation: false,
      // VIOLATION: sandbox must be true where feasible.
      sandbox: false
    }
  });

  // touch the forbidden imports so linters cannot dead-code-eliminate them
  fs.readFileSync(join(app.getPath('userData'), 'x'));
  exec('echo bad');
  remote.require('fs');
  ipcRenderer.send('raw-channel', 'leak');

  return win;
}
