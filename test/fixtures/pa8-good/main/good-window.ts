// PA-8 FIXTURE — HARDENED / GOOD. Must PASS the PA-8 gate (zero violations).
// Demonstrates the compliant baseline the real src/ tree must match.
// Scanned via `npm run pa8:scan:fixture-good`. NEVER imported by the app.

import { BrowserWindow } from 'electron';

// Compliant webPreferences: isolation on, node integration off, sandboxed.
export function createHardenedWindow(): BrowserWindow {
  return new BrowserWindow({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
}
