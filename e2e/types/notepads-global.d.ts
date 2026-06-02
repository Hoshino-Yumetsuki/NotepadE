/**
 * Ambient `window.notepads` declaration for the E2E suite.
 *
 * This is a MINIMAL surface covering only what the walking-skeleton round-trip
 * test exercises (file.open / file.save). The authoritative contract is
 * `src/shared/ipc-contract.ts` (task #1, Lane A/lead). Once that ships, replace
 * the body below with `import type { NotepadsApi } from '../src/shared/ipc-contract'`
 * and `interface Window { notepads: NotepadsApi }`.
 *
 * Kept self-contained so the harness type-checks before the scaffold exists.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface OpenedFile {
  decodedText: string;
  encodingId: string;
  eolId: string;
  dateModifiedMs: number;
  filePath: string | null;
}

interface SaveArgs {
  filePath: string;
  shadowText?: string;
  encodingId?: string;
  eolId?: string;
}

interface NotepadsApiMinimal {
  file: {
    open(path: string): Promise<Result<OpenedFile>>;
    save(args: SaveArgs): Promise<Result<{ filePath: string }>>;
  };
}

declare global {
  interface Window {
    notepads: NotepadsApiMinimal;
  }
}

export {};
