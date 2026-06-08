/**
 * Platform detection helpers.
 *
 * Centralized so every keyboard-handler, label, and menu can render
 * platform-appropriate shortcuts without ad-hoc userAgent checks.
 *
 * - isMac  → macOS (Darwin)
 * - isWindows → Windows (win32)
 * - modKey → "⌘" or "Ctrl" for display labels
 */

// In the renderer (tsconfig.web.json) process is not declared. Declare it as
// optional so the main/preload fallback compiles in both targets.
declare const process: { platform: string } | undefined;

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';

export const isMac = ((): boolean => {
  if (UA) return UA.includes('Mac');
  if (typeof process !== 'undefined' && process?.platform) {
    return process.platform === 'darwin';
  }
  return false;
})();

export const isWindows = ((): boolean => {
  if (UA) return UA.includes('Windows');
  if (typeof process !== 'undefined' && process?.platform) {
    return process.platform === 'win32';
  }
  return false;
})();

/** Display label for the primary modifier key. */
export const modKey = isMac ? '⌘' : 'Ctrl';
