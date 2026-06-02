/**
 * Shadow-buffer line-ending utilities (RENDERER, Lane B).
 *
 * Authority contract (docs/plan/04-phase-3-editor-core.md §3.A):
 *   MAIN reads bytes, decodes, and sends authoritative {decodedText, encodingId,
 *   eolId}. The RENDERER normalizes decodedText to a single-'\n' shadow buffer
 *   used for editing ONLY, and NEVER re-derives encoding/EOL from that buffer
 *   (re-deriving off a normalized buffer always reports the normalized EOL and
 *   corrupts round-trips). The opaque eolId/encodingId labels are carried as
 *   state and re-applied by MAIN on save.
 *
 * Note: the reference UWP editor normalizes its working buffer to a single '\r'
 * (RichEditBoxDefaultLineEnding). CodeMirror 6's native document line break is
 * '\n', which preserves the same one-character-per-break offset arithmetic the
 * UWP command implementations rely on — so we normalize to '\n' here. The choice
 * of normalized break character is internal; only MAIN's eolId is authoritative.
 */

/** The renderer shadow-buffer line break. CM6's native document break. */
export const SHADOW_EOL = '\n';

/**
 * Normalize arbitrary decoded text (which may contain CRLF / CR / LF, mixed) to
 * the single-'\n' shadow buffer the editor edits against.
 *
 * This is a pure string transform. It does NOT and MUST NOT infer or return an
 * EOL label — the authoritative eolId comes from MAIN over IPC.
 */
export function normalizeToShadow(decodedText: string): string {
  // CRLF first, then bare CR, so a "\r\n" never leaves a stray "\n".
  return decodedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
