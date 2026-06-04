import type { FileModificationState } from './StatusBar';

/**
 * fileStatusTracker — renderer-local last-saved-mtime ledger for the column-0
 * external-modification indicator (Lane C, Gate-4 line 3).
 *
 * Mirrors the UWP TextEditor's per-editor `_fileModificationState` +
 * `LastSavedFileModificationTime` bookkeeping (TextEditor.xaml.cs:412
 * CheckAndUpdateFileStatusAsync). We DELIBERATELY do not widen TabState (it is
 * snapshot-serialized + lane-shared); this is a tiny module-level singleton keyed
 * by editorId so only Lane C owns it. PA-8 clean — pure data, no IPC/fs.
 *
 * The authoritative `dateModifiedMs` is recorded from MAIN's OpenedFile (at open
 * / reload) and SaveResult (at save). A later revalidatePath() result is compared
 * against this baseline to derive the indicator state.
 */

/** The last-saved mtime baseline for one file-backed editor. */
interface FileStatusEntry {
  /** Absolute path the baseline was captured for (guards stale path reuse). */
  filePath: string;
  /** epoch-ms the file had when we last opened/saved/reloaded it. */
  lastSavedMs: number;
}

const entries = new Map<string, FileStatusEntry>();

/** Record (or refresh) the last-saved baseline for `editorId` after open/save/reload. */
export function recordLastSaved(editorId: string, filePath: string, lastSavedMs: number): void {
  entries.set(editorId, { filePath, lastSavedMs });
}

/** Drop an editor's baseline (tab closed). */
export function forgetEditor(editorId: string): void {
  entries.delete(editorId);
}

/** The recorded baseline for `editorId`, or undefined if none. */
export function getLastSaved(editorId: string): FileStatusEntry | undefined {
  return entries.get(editorId);
}

/** A revalidatePath() outcome, mirroring the contract's revalidatePath data. */
export interface RevalidateOutcome {
  exists: boolean;
  dateModifiedMs: number;
}

/**
 * Derive the column-0 indicator state from a revalidate outcome vs the baseline
 * (UWP UpdateFileModificationStateIndicator mapping, StatusBar.cs:79):
 *   - missing file (exists:false)              → 'renamedMovedDeleted' (E9CE)
 *   - present but mtime moved off the baseline  → 'modifiedOutside'    (E7BA)
 *   - present and mtime matches the baseline    → 'none'               (collapsed)
 *
 * A null outcome (no path / untitled / not yet checked) is 'none'. The baseline
 * filePath must match `filePath` or we treat it as not-yet-tracked ('none'),
 * so a path change between record and check never yields a false positive.
 */
export function deriveModificationState(
  filePath: string | null,
  outcome: RevalidateOutcome | null,
  baseline: FileStatusEntry | undefined,
): FileModificationState {
  if (filePath === null || outcome === null) return 'none';
  if (!outcome.exists) return 'renamedMovedDeleted';
  if (!baseline || baseline.filePath !== filePath) return 'none';
  return outcome.dateModifiedMs !== baseline.lastSavedMs ? 'modifiedOutside' : 'none';
}
