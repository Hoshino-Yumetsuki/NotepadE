import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileWithRetry, dialogDefaultPath, SAVE_DIALOG_FILTERS } from './file-io';

/**
 * Unit tests for the transient-lock write retry (W2) plus the Save-As dialog's
 * pure helpers (filter list + defaultPath composition). The writer is injected
 * so these run without touching the real filesystem; dialogDefaultPath takes the
 * Documents fallback as a parameter so vitest never calls app.getPath
 * (electron-free by convention — the dialog itself stays e2e).
 */

function fsError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

const BYTES = Buffer.from('hello');

describe('writeFileWithRetry', () => {
  it('succeeds on the first attempt when the write is clean', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    await writeFileWithRetry('/x', BYTES, 3, 0, writeFn);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient EBUSY then succeeds', async () => {
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(fsError('EBUSY'))
      .mockResolvedValueOnce(undefined);
    await writeFileWithRetry('/x', BYTES, 3, 0, writeFn);
    expect(writeFn).toHaveBeenCalledTimes(2);
  });

  it('retries up to the limit then throws the last transient error', async () => {
    const writeFn = vi.fn().mockRejectedValue(fsError('EPERM'));
    await expect(writeFileWithRetry('/x', BYTES, 3, 0, writeFn)).rejects.toMatchObject({
      code: 'EPERM'
    });
    expect(writeFn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-transient error (ENOENT) — throws immediately', async () => {
    const writeFn = vi.fn().mockRejectedValue(fsError('ENOENT'));
    await expect(writeFileWithRetry('/x', BYTES, 3, 0, writeFn)).rejects.toMatchObject({
      code: 'ENOENT'
    });
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('treats EACCES (read-only file) as transient and retries', async () => {
    const writeFn = vi.fn().mockRejectedValue(fsError('EACCES'));
    await expect(writeFileWithRetry('/x', BYTES, 2, 0, writeFn)).rejects.toMatchObject({
      code: 'EACCES'
    });
    expect(writeFn).toHaveBeenCalledTimes(2);
  });
});

describe('dialogDefaultPath (Save As default filename, UWP FileSavePicker parity)', () => {
  it('joins suggestedName onto the explicit defaultDir', () => {
    expect(dialogDefaultPath({ suggestedName: 'notes.txt', defaultDir: 'C:\\docs' })).toBe(
      join('C:\\docs', 'notes.txt')
    );
  });

  it('anchors an untitled buffer (no defaultDir) to the Documents fallback', () => {
    // THE "NotepadE" bug: a bare relative name reaches Windows' IFileSaveDialog
    // unreliably (the name field comes up blank and the shell substitutes the
    // product name). With the fallback dir the composed path is absolute and
    // the tab title lands in the dialog's filename box.
    expect(dialogDefaultPath({ suggestedName: 'Untitled 1' }, 'C:\\Users\\me\\Documents')).toBe(
      join('C:\\Users\\me\\Documents', 'Untitled 1')
    );
  });

  it('prefers the explicit defaultDir over the Documents fallback', () => {
    expect(
      dialogDefaultPath({ suggestedName: 'a.txt', defaultDir: 'D:\\work' }, 'C:\\Documents')
    ).toBe(join('D:\\work', 'a.txt'));
  });

  it('returns the bare directory when no name is suggested', () => {
    expect(dialogDefaultPath({ defaultDir: 'C:\\docs' })).toBe('C:\\docs');
    expect(dialogDefaultPath({}, 'C:\\Documents')).toBe('C:\\Documents');
  });

  it('degrades to the bare name only when NO directory is resolvable', () => {
    expect(dialogDefaultPath({ suggestedName: 'x.txt' })).toBe('x.txt');
    expect(dialogDefaultPath({})).toBeUndefined();
  });
});

describe('SAVE_DIALOG_FILTERS (txt-only save surface)', () => {
  it('offers exactly ONE type: Text Documents (*.txt)', () => {
    expect(SAVE_DIALOG_FILTERS).toHaveLength(1);
    expect(SAVE_DIALOG_FILTERS[0].name).toContain('*.txt');
    expect(SAVE_DIALOG_FILTERS[0].extensions).toEqual(['txt']);
  });

  it('uses Electron-conformant extensions (no dots, no wildcards)', () => {
    for (const f of SAVE_DIALOG_FILTERS) {
      expect(f.extensions.length).toBeGreaterThan(0);
      for (const ext of f.extensions) {
        // '.txt' and '*.txt' are documented-invalid Electron filter formats.
        expect(ext).toMatch(/^[a-z0-9]+$/);
      }
    }
  });
});
