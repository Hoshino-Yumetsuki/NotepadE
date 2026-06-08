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
import { installWindowTestSeam, initCloseGuardQuitBypass } from './window.js';
import { registerIpcHandlers } from './ipc.js';
import { initThemePush } from './theme.js';
import { initJumpListTasks } from './shell.js';
import { initSystemAnsiCodePage } from './system-codepage.js';
import {
  acquireSingleInstance,
  registerProtocolClient,
  initBroker,
  registerEarlyOpenHandlers,
  processInitialActivation,
  flushPendingActivation,
  flushColdStartActivations,
  installMainTestSeam
} from './broker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRenderer(win: BrowserWindow): void {
  // vite-plugin-electron sets VITE_DEV_SERVER_URL in dev; keep ELECTRON_RENDERER_URL
  // as a fallback for any external launcher. Absent both → production file load.
  const devServerUrl = process.env['VITE_DEV_SERVER_URL'] ?? process.env['ELECTRON_RENDERER_URL'];
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
  // Disarm the per-window close guard during an app-level quit (exit-when-last-tab,
  // window-all-closed, OS shutdown) so those paths are never blocked.
  initCloseGuardQuitBypass();
  // e2e-only MAIN seam (broker internals via app.evaluate). No-op in production.
  installMainTestSeam();
  // e2e-only window-state reader on the same seam (Gate-7 compact matrix). No-op
  // in production; installed after the broker seam so it augments the base object.
  installWindowTestSeam();
  // Best-effort, non-critical init deferred OFF the first-paint path (cold-start
  // win): neither is needed before the window shows. setImmediate runs them after
  // the current boot tick (post-first-paint) so they never delay the visible window.
  //  - initJumpListTasks: Windows Jump List "New window" task (win32-only).
  //  - initSystemAnsiCodePage: resolve the OS ANSI code page once for the encoding
  //    engine's system-ANSI fallback. systemAnsiCodePage() self-initializes lazily
  //    with a 1252 fallback, so an early file-open before this fires is still safe.
  setImmediate(() => {
    initJumpListTasks();
    initSystemAnsiCodePage();
  });
}

function bootstrap(): void {
  initOnce();
  spawnWindow();
  // Flush any macOS cold-start file/protocol activations into the first window
  // BEFORE processing argv (so argv-based paths, if any, are the final set).
  flushColdStartActivations();
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
 * GPU workaround (Win11 / workstation / virtualized GPUs) — ENV-CONFIGURABLE.
 *
 * Symptom: "ContextResult::kFatalFailure: Failed to create shared context for
 * virtualization." → "Exiting GPU process due to errors during initialization",
 * dropping the window into software compositing (severe scroll/typing lag) or a
 * blank window. This is a Chromium GPU-process failure creating its shared GL
 * context, seen on specific Windows GPU/driver/virtualization stacks (multi-GPU,
 * "Windows for Workstations", GPU-PV, RDP). It is hardware/driver-specific: it
 * does NOT reproduce on every machine, so there is no single switch that is
 * universally correct — the working combination must be found on the affected
 * machine. `scripts/gpu-diag.mjs` sweeps the candidates and reports which are
 * clean; set the winner via the env vars below (no rebuild needed).
 *
 *   NOTEPADS_ANGLE=<backend>   → --use-angle=<backend>  (d3d11 | d3d9 | gl |
 *                                 vulkan | swiftshader). Trying a different ANGLE
 *                                 backend is the most common fix for this error.
 *   NOTEPADS_DISABLE_GPU_COMPOSITING=1 → --disable-gpu-compositing (keep GPU
 *                                 raster, software-composite; keeps the app fast
 *                                 while sidestepping the shared-context path).
 *   NOTEPADS_DISABLE_GPU=1     → --disable-gpu (last resort; KILLS the acrylic
 *                                 backdrop, but guarantees no GPU process).
 *
 * Default (no env set): apply nothing. The bare Electron default works on most
 * machines (verified locally), and a blind switch can REGRESS a healthy machine
 * (e.g. --in-process-gpu actively triggers this very error here). Win11 keeps
 * GPU rasterization on by default, so we no longer force it.
 *
 * Switches must be appended before app.whenReady(); module top-level satisfies it.
 */
function applyGpuWorkarounds(): void {
  if (process.platform !== 'win32') return;
  const angle = process.env['NOTEPADS_ANGLE'];
  if (angle && angle.length > 0) {
    app.commandLine.appendSwitch('use-angle', angle);
  }
  if (process.env['NOTEPADS_DISABLE_GPU_COMPOSITING'] === '1') {
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }
  if (process.env['NOTEPADS_DISABLE_GPU'] === '1') {
    app.disableHardwareAcceleration();
  }
}

applyGpuWorkarounds();

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
  // macOS open-file/open-url must be registered BEFORE app.whenReady() because
  // those events can fire before the ready event on cold start. Paths that
  // arrive pre-bootstrap are queued and flushed after the first window exists.
  registerEarlyOpenHandlers();

  app.whenReady().then(() => {
    // Windows taskbar identity: group windows + show the embedded exe icon under
    // a stable AppUserModelID (must match electron-builder's appId). No-op
    // elsewhere. Set before any window is created.
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.notepade.app');
    }
    bootstrap();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
