/**
 * GPU flag diagnostic (permanent tool). Launches the BUILT main process under a
 * sweep of GPU switch sets and reports, per trial, whether the fatal GPU error
 * still appears in stderr. Use this ON AN AFFECTED MACHINE to find the switch
 * that clears "Failed to create shared context for virtualization", then set the
 * winning combo via the NOTEPADS_ANGLE / NOTEPADS_DISABLE_GPU_COMPOSITING /
 * NOTEPADS_DISABLE_GPU env vars (see src/main/index.ts applyGpuWorkarounds).
 *
 *   yarn build && yarn gpu:diag
 *
 * Each trial boots Electron for ~4.5s with NOTEPADS_E2E=1 (single-instance lock
 * bypassed), greps stderr for the fatal markers, then kills it. A trial is
 * "clean" if none of the fatal markers appear.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const mainEntry = resolve(process.cwd(), 'out/main/index.js');

const FATAL = [
  'Failed to create shared context for virtualization',
  'Exiting GPU process due to errors during initialization'
];

// Each trial is raw Chromium switches passed on argv. The env-configurable
// workaround in src/main maps NOTEPADS_ANGLE→--use-angle, etc; here we pass the
// switches directly so the sweep is independent of that mapping.
const trials = [
  { name: 'baseline (Electron default)', flags: [] },
  { name: '--no-sandbox (the OLD dev template default)', flags: ['--no-sandbox'] },
  { name: '--no-sandbox + angle=d3d11', flags: ['--no-sandbox', '--use-angle=d3d11'] },
  { name: '--no-sandbox + angle=gl', flags: ['--no-sandbox', '--use-angle=gl'] },
  {
    name: '--no-sandbox + disable-gpu-compositing',
    flags: ['--no-sandbox', '--disable-gpu-compositing']
  },
  { name: 'angle=d3d11', flags: ['--use-angle=d3d11'] },
  { name: 'angle=d3d9', flags: ['--use-angle=d3d9'] },
  { name: 'angle=gl', flags: ['--use-angle=gl'] },
  { name: 'angle=vulkan', flags: ['--use-angle=vulkan'] },
  { name: 'angle=swiftshader (CPU/WARP)', flags: ['--use-angle=swiftshader'] },
  { name: 'disable-gpu-compositing', flags: ['--disable-gpu-compositing'] },
  { name: 'disable-gpu (no acrylic)', flags: ['--disable-gpu'] }
];

function runTrial(t) {
  return new Promise((res) => {
    const child = spawn(electronPath, [mainEntry, ...t.flags], {
      env: { ...process.env, NOTEPADS_E2E: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let buf = '';
    child.stdout.on('data', (d) => (buf += d));
    child.stderr.on('data', (d) => (buf += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 4500);
    child.on('exit', () => {
      clearTimeout(timer);
      const hits = FATAL.filter((m) => buf.includes(m));
      const gpuLines = buf
        .split('\n')
        .filter((l) => /GPU|virtualiz|ContextResult|gl_factory|angle|swiftshader/i.test(l))
        .slice(0, 3);
      res({ name: t.name, fatal: hits.length > 0, hits, gpuLines });
    });
  });
}

const results = [];
for (const t of trials) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await runTrial(t));
}

console.log('\n=== GPU FLAG DIAGNOSTIC ===');
console.log('Platform:', process.platform, '| Electron main:', mainEntry, '\n');
for (const r of results) {
  console.log(`${r.fatal ? '❌ FATAL' : '✅ clean'}  ${r.name}`);
  if (r.hits.length) console.log(`        hits: ${r.hits.join(' | ')}`);
  for (const s of r.gpuLines) console.log(`        > ${s.trim()}`);
}
const firstClean = results.find((r) => !r.fatal && r.name !== 'baseline (Electron default)');
const baselineClean =
  results.find((r) => r.name === 'baseline (Electron default)')?.fatal === false;
console.log('\n--- RECOMMENDATION ---');
if (baselineClean) {
  console.log('Baseline is clean on this machine — no GPU workaround needed. Leave the');
  console.log('NOTEPADS_ANGLE / NOTEPADS_DISABLE_GPU* env vars UNSET.');
} else if (firstClean) {
  console.log(`Baseline FAILS here. First clean alternative: "${firstClean.name}".`);
  console.log('Map it to the env var, e.g. an angle=<x> trial → NOTEPADS_ANGLE=<x>,');
  console.log('disable-gpu-compositing → NOTEPADS_DISABLE_GPU_COMPOSITING=1,');
  console.log('disable-gpu → NOTEPADS_DISABLE_GPU=1.');
} else {
  console.log('Every trial showed the fatal error — capture full stderr and file an issue.');
}
console.log('');
process.exit(0);
