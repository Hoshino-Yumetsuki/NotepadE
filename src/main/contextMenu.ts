/**
 * Explorer "Open with NotepadsE" context-menu toggle — MAIN, Windows only.
 *
 * Writes or removes HKCU\Software\Classes\*\shell\NotepadsE. HKCU means no
 * elevation is needed. No-op on non-Windows platforms.
 */

import { execFile } from 'node:child_process';
import { app } from 'electron';

const KEY = 'HKCU\\Software\\Classes\\*\\shell\\NotepadsE';

function reg(...args: string[]): void {
  if (process.platform !== 'win32') return;
  execFile('reg', args, (err) => {
    if (err) console.warn('[contextMenu] reg', args[0], err.message);
  });
}

export function applyContextMenu(enable: boolean): void {
  if (process.platform !== 'win32') return;
  if (enable) {
    const exe = app.getPath('exe');
    reg('add', KEY, '/ve', '/d', 'Open with NotepadsE', '/f');
    reg('add', KEY, '/v', 'Icon', '/d', `"${exe}",0`, '/f');
    reg('add', `${KEY}\\command`, '/ve', '/d', `"${exe}" "%1"`, '/f');
  } else {
    reg('delete', KEY, '/f');
  }
}
