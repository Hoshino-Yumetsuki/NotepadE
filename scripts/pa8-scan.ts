#!/usr/bin/env tsx
/**
 * PA-8 Security Gate — static scanner (build-breaking).
 *
 * NOTE: This scanner originally enforced Electron security policies
 * (nodeIntegration, contextIsolation, sandbox, forbidden Node imports in
 * renderer, raw ipcRenderer exposure). Since the project has been ported to
 * Tauri v2, the Electron-specific rules no longer apply.
 *
 * A future iteration should adopt Tauri-specific rules (e.g. no raw invoke()
 * outside the bridge layer, no shell.execute() without allowlist, no fs access
 * outside the Rust side). Until then, this script is a no-op placeholder that
 * always passes so `yarn typecheck:node` (tsconfig.node.json, which includes
 * scripts/) does not fail on this file.
 *
 * Remove this file entirely once Tauri security scanning rules are defined and
 * wired into CI.
 */

import { existsSync } from 'node:fs';

const ROOTS_DEFAULT = ['src/renderer', 'src/shared'];

const argv = process.argv.slice(2);
const roots: string[] = [];
let expectFail = false;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    roots.push(argv[++i]);
  } else if (argv[i] === '--expect-fail') {
    expectFail = true;
  }
}

if (roots.length === 0) {
  roots.push(...ROOTS_DEFAULT);
}

let missing = false;
for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`PA-8: root not found: ${root}`);
    missing = true;
  }
}

if (missing) {
  console.error('\nPA-8 SECURITY GATE: FAIL — one or more scan roots do not exist.');
  process.exit(expectFail ? 0 : 1);
}

console.log(
  'PA-8 SECURITY GATE: PASS — no violations found (Tauri adapter: rules not yet defined).'
);
console.log(`Scanned 0 file(s) under: ${roots.join(', ')}.`);
console.log('(Tauri port — Electron security rules are no longer applicable.)');

if (expectFail) {
  console.error('\n[--expect-fail] Expected violations but found none. Harness broken?');
  process.exit(1);
}
process.exit(0);
