/**
 * Argv / activation parsing — MAIN, PURE (no electron / fs / IPC).
 *
 * Extracted from `broker.ts` so the argv→{paths, protocolUrl} decision, the
 * `notepads://` protocol detection, and cwd-relative path resolution are
 * unit-testable in the vitest env WITHOUT importing `electron` (which cannot load
 * there). `broker.ts` calls these, supplying electron's `process.execPath` /
 * `app.getAppPath()` as plain string params so this module stays electron-free.
 *
 * Parity: ports the UWP App.xaml.cs activation argv handling +
 * NotepadsProtocolService — on Windows, file/protocol activation arrives as extra
 * argv on the primary's 'second-instance' (NOT macOS open-url/open-file), so the
 * paths and the `notepads://` url are parsed out of argv against the captured cwd.
 */

import { resolve, isAbsolute } from 'node:path';

/** The `notepads://` custom protocol scheme (UWP NotepadsProtocolService). */
export const PROTOCOL_SCHEME = 'notepads';
/** Protocol verb that always forces a new instance/window. */
export const NEW_INSTANCE_VERB = 'newinstance';

/** Parsed activation argv: candidate file paths + an optional protocol url. */
export interface ParsedArgv {
  paths: string[];
  protocolUrl: string | null;
}

/**
 * Fixed bits of process identity the pure parser needs in order to skip
 * electron's own argv entries (the executable + the bundled main entry / app
 * path) without importing electron.
 */
export interface ArgvEnv {
  execPath: string;
  appPath: string;
}

/** Resolve a single argv token to an absolute path against `cwd`. */
export function resolveCwdRelative(token: string, cwd: string): string {
  return isAbsolute(token) ? token : resolve(cwd, token);
}

/**
 * Parse an argv array into file paths + an optional `notepads://` url. The first
 * element is the executable (and, in dev, the script) — we skip electron's own
 * switches (leading '-') and the app path, keeping bare tokens as candidate
 * paths. A token matching the protocol scheme is captured as the protocol url.
 * Bare relative tokens are resolved against `cwd` (the cwd captured at activation,
 * NOT the primary's cwd — UWP parity).
 */
export function parseArgv(argv: readonly string[], cwd: string, env: ArgvEnv): ParsedArgv {
  const paths: string[] = [];
  let protocolUrl: string | null = null;
  for (const token of argv) {
    if (!token || token.startsWith('-')) continue;
    if (token.startsWith(`${PROTOCOL_SCHEME}://`)) {
      protocolUrl = token;
      continue;
    }
    // Skip the electron executable and the bundled main entry on cold start.
    if (token === env.execPath) continue;
    if (token.endsWith('.js') || token.endsWith('.cjs') || token.endsWith('.mjs')) continue;
    if (token === '.' || token === env.appPath) continue;
    paths.push(resolveCwdRelative(token, cwd));
  }
  return { paths, protocolUrl };
}

/** Does the protocol url request a brand-new instance (the `newinstance` verb)? */
export function isNewInstanceProtocol(protocolUrl: string | null): boolean {
  if (!protocolUrl) return false;
  const rest = protocolUrl.slice(`${PROTOCOL_SCHEME}://`.length).replace(/\/+$/, '');
  return rest.toLowerCase() === NEW_INSTANCE_VERB;
}
