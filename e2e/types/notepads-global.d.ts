/**
 * Ambient `window.notepads` declaration for the E2E suite.
 *
 * Binds the global `window.notepads` to the AUTHORITATIVE contract type
 * exported by src/shared/ipc-contract.ts (Lane A). The E2E tests assert against
 * this exact surface — no minimal stub, no drift.
 */

import type { NotepadsApi } from '../../src/shared/ipc-contract';

declare global {
  interface Window {
    notepads: NotepadsApi;
  }
}

export {};
