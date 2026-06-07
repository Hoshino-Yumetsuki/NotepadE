/**
 * System ANSI code page resolver — MAIN only.
 *
 * UWP's encoding ladder uses `Encoding.GetEncoding(0)` (the OS ANSI code page,
 * a.k.a. ACP) as a fallback when detection is ambiguous. The earlier port
 * hardcoded windows-1252; this resolves the REAL ACP so a non-Western system
 * (e.g. 932 Shift-JIS on a Japanese install, 936 GBK on a Simplified-Chinese
 * install) falls back correctly.
 *
 * We read the ACP from the registry value
 *   HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage\ACP
 * via `reg query` (Node child_process — MAIN-only, no native module; koffi could
 * not be cleanly bundled by the rolldown toolchain). The lookup runs ONCE and is
 * cached. Every failure path (non-win32, reg missing, parse failure) falls back to
 * 1252, the most common Western ACP, so this can never break the encoding engine.
 *
 * MAIN-process only; never touches the renderer (PA-8).
 */

import { execFile } from 'node:child_process';

/** Cached resolved code page (0 = not yet resolved). */
let cachedAcp = 0;

const ACP_REG_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage';

/**
 * Kick off the one-time ACP resolution (win32 only). The result lands in the cache
 * for the synchronous `systemAnsiCodePage()` reads the encoding engine makes. Safe
 * to call repeatedly; only the first invocation does work. Best-effort — any
 * failure leaves the 1252 fallback in place.
 */
export function initSystemAnsiCodePage(): void {
  if (cachedAcp !== 0) return;
  if (process.platform !== 'win32') {
    cachedAcp = 1252;
    return;
  }
  try {
    execFile('reg', ['query', ACP_REG_KEY, '/v', 'ACP'], { windowsHide: true }, (err, stdout) => {
      if (err) {
        cachedAcp = 1252;
        return;
      }
      // Output line looks like: "    ACP    REG_SZ    1252"
      const m = /ACP\s+REG_SZ\s+(\d+)/i.exec(stdout);
      const cp = m ? Number.parseInt(m[1], 10) : Number.NaN;
      cachedAcp = Number.isInteger(cp) && cp > 0 ? cp : 1252;
    });
  } catch {
    cachedAcp = 1252;
  }
}

/**
 * Return the OS ANSI code page number (e.g. 1252, 932, 936). Resolved lazily and
 * cached; until `initSystemAnsiCodePage()` completes, returns 1252. Falls back to
 * 1252 off win32 or when the registry read fails.
 */
export function systemAnsiCodePage(): number {
  if (cachedAcp !== 0) return cachedAcp;
  // Not yet resolved — kick off the async read and return the safe default for now.
  initSystemAnsiCodePage();
  return cachedAcp === 0 ? 1252 : cachedAcp;
}

/** Test-only: reset the cached ACP so a fresh resolve runs (unit tests). */
export function __resetSystemAnsiCacheForTest(): void {
  cachedAcp = 0;
}

/** Test-only: force a specific cached ACP (unit tests, deterministic mapping). */
export function __setSystemAnsiCacheForTest(cp: number): void {
  cachedAcp = cp;
}
