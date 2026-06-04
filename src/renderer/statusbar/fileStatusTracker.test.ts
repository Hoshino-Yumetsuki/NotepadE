import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLastSaved,
  forgetEditor,
  getLastSaved,
  deriveModificationState,
} from './fileStatusTracker';

/**
 * fileStatusTracker spec — the pure column-0 state-machine + per-editor baseline
 * ledger (Lane C, Gate-4 line 3). Mirrors the UWP UpdateFileModificationStateIndicator
 * mapping; no IPC/fs involved.
 */

describe('fileStatusTracker', () => {
  beforeEach(() => {
    // Each test owns its editorIds; clear the ones we use.
    forgetEditor('e1');
    forgetEditor('e2');
  });

  it('records and reads back a last-saved baseline', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    expect(getLastSaved('e1')).toEqual({ filePath: 'C:\\a.txt', lastSavedMs: 1000 });
  });

  it('forgets a baseline on close', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    forgetEditor('e1');
    expect(getLastSaved('e1')).toBeUndefined();
  });

  it('maps an untitled (null path) tab to none', () => {
    expect(deriveModificationState(null, { exists: true, dateModifiedMs: 5 }, undefined)).toBe('none');
  });

  it('maps a null outcome (not yet checked) to none', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    expect(deriveModificationState('C:\\a.txt', null, getLastSaved('e1'))).toBe('none');
  });

  it('maps a missing file to renamedMovedDeleted (E9CE)', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    expect(
      deriveModificationState('C:\\a.txt', { exists: false, dateModifiedMs: 0 }, getLastSaved('e1')),
    ).toBe('renamedMovedDeleted');
  });

  it('maps a present file with a moved mtime to modifiedOutside (E7BA)', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    expect(
      deriveModificationState('C:\\a.txt', { exists: true, dateModifiedMs: 2000 }, getLastSaved('e1')),
    ).toBe('modifiedOutside');
  });

  it('maps a present file with an unchanged mtime to none', () => {
    recordLastSaved('e1', 'C:\\a.txt', 1000);
    expect(
      deriveModificationState('C:\\a.txt', { exists: true, dateModifiedMs: 1000 }, getLastSaved('e1')),
    ).toBe('none');
  });

  it('treats a baseline for a different path as not-yet-tracked (none)', () => {
    // Path changed (rename/save-as) between record and check: never a false positive.
    recordLastSaved('e1', 'C:\\old.txt', 1000);
    expect(
      deriveModificationState('C:\\new.txt', { exists: true, dateModifiedMs: 2000 }, getLastSaved('e1')),
    ).toBe('none');
  });

  it('treats a present file with no baseline at all as none', () => {
    expect(
      deriveModificationState('C:\\a.txt', { exists: true, dateModifiedMs: 2000 }, undefined),
    ).toBe('none');
  });
});
