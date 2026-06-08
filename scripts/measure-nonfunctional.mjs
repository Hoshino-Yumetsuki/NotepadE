/**
 * Non-functional measurement harness (Gate-8, docs/plan/09-phase-8).
 *
 * Measures the SR-8 ceilings against the built app:
 *   - Cold start   : launch → first window domcontentloaded   (≤ 2000 ms)
 *   - Idle RAM     : summed private memory of all processes    (≤ 250 MB)
 *   - 1 MB open    : file.open IPC round-trip for a 1 MB file   (≤ 300 ms)
 *
 * These are honest Electron-achievable ceilings, NOT UWP parity. A miss is a
 * red-flag divergence requiring sign-off, not a silent failure — the script exits
 * non-zero and prints which target was exceeded.
 *
 * Run AFTER `yarn build` (it launches out/main/index.js). Usage: `node scripts/measure-nonfunctional.mjs`.
 */

import { _electron as electron } from 'playwright';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGETS = {
  coldStartMs: 2000,
  idleRamMB: 250,
  openMs: 300
};

function resolveMainEntry() {
  const candidates = [
    join(process.cwd(), 'out', 'main', 'index.js'),
    join(process.cwd(), 'dist', 'main', 'index.js')
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('Electron main entry not found. Run `yarn build` first.');
}

async function main() {
  const main = resolveMainEntry();
  const userDataDir = mkdtempSync(join(tmpdir(), 'notepads-measure-'));

  // --- Cold start: time from launch() to first window DOM ready. ---
  const t0 = Date.now();
  const app = await electron.launch({
    args: [main],
    env: { ...process.env, NOTEPADS_E2E: '1', NOTEPADS_E2E_USERDATA: userDataDir }
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const coldStartMs = Date.now() - t0;

  // Let the app settle, then sample memory across all processes.
  await page.waitForTimeout(1500);
  const metrics = await app.evaluate(async ({ app }) => app.getAppMetrics());
  const idleRamMB =
    metrics.reduce((sum, m) => sum + (m.memory?.privateBytes ?? m.memory?.workingSetSize ?? 0), 0) /
    1024; // privateBytes/workingSetSize are in KB → MB

  // --- 1 MB open latency: write a 1 MB file, time file.open IPC round-trip. ---
  const bigFile = join(userDataDir, 'onemb.txt');
  writeFileSync(bigFile, 'a'.repeat(1024 * 1024), 'utf8');
  const openMs = await page.evaluate(async (path) => {
    const t = performance.now();
    await window.notepads.file.open(path);
    return performance.now() - t;
  }, bigFile);

  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });

  // --- Report ---
  const rows = [
    [
      'Cold start',
      coldStartMs.toFixed(0) + ' ms',
      TARGETS.coldStartMs + ' ms',
      coldStartMs <= TARGETS.coldStartMs
    ],
    [
      'Idle RAM',
      idleRamMB.toFixed(0) + ' MB',
      TARGETS.idleRamMB + ' MB',
      idleRamMB <= TARGETS.idleRamMB
    ],
    ['1 MB open', openMs.toFixed(0) + ' ms', TARGETS.openMs + ' ms', openMs <= TARGETS.openMs]
  ];
  console.log('\nNon-functional measurements (Gate-8):\n');
  for (const [name, got, target, ok] of rows) {
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(12)} ${String(got).padStart(10)}  (target ≤ ${target})`
    );
  }
  const failures = rows.filter((r) => !r[3]);
  if (failures.length > 0) {
    console.log(
      `\n${failures.length} target(s) exceeded — red-flag divergence (needs sign-off).\n`
    );
    process.exit(1);
  }
  console.log('\nAll non-functional targets met.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
