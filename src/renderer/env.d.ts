/// <reference types="vite/client" />

/**
 * Renderer-side global augmentation. The authoritative shape lives in
 * src/shared/ipc-contract.ts; importing it here installs `window.notepads`
 * for the entire renderer tree. The renderer uses ONLY this surface (PA-8).
 */
import type { NotepadsApi } from '@shared/ipc-contract';

declare global {
  interface Window {
    notepads: NotepadsApi;
  }
}

export {};
