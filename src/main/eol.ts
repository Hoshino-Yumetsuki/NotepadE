/**
 * EOL detection + application — MAIN only.
 *
 * Port of UWP's LineEndingUtility (src/Notepads/Utilities/LineEndingUtility.cs:17-35).
 * Detected ONCE from raw text on read; re-applied only at save. Default = CRLF.
 */

import type { EolId } from '../shared/ipc-contract.js';

/**
 * Detect the EOL style from raw decoded text.
 *   contains "\r\n" -> crlf
 *   else contains "\r" -> cr
 *   else contains "\n" -> lf
 *   else (no breaks)  -> crlf (UWP default)
 */
export function detectEol(text: string): EolId {
  if (text.includes('\r\n')) return 'crlf';
  if (text.includes('\r')) return 'cr';
  if (text.includes('\n')) return 'lf';
  return 'crlf';
}

const EOL_STRING: Record<EolId, string> = {
  crlf: '\r\n',
  cr: '\r',
  lf: '\n'
};

/**
 * Normalize any mix of CRLF/CR/LF to single '\n' (the renderer's shadow-buffer
 * form). MAIN sends decodedText raw; the renderer normalizes — but encode()
 * below assumes a '\n'-normalized input, so we normalize here defensively.
 */
export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Re-apply the target EOL to a '\n'-normalized text just before encoding. */
export function applyEol(lfText: string, eol: EolId): string {
  const normalized = normalizeToLf(lfText);
  if (eol === 'lf') return normalized;
  return normalized.replace(/\n/g, EOL_STRING[eol]);
}
