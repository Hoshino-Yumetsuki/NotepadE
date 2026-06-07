import { describe, it, expect, vi } from 'vitest';
import { writeFileWithRetry } from './file-io';

/**
 * Unit tests for the transient-lock write retry (W2). The writer is injected so
 * these run without touching the real filesystem. Backoff is set to 0ms to keep
 * the tests fast.
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
      code: 'EPERM',
    });
    expect(writeFn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-transient error (ENOENT) — throws immediately', async () => {
    const writeFn = vi.fn().mockRejectedValue(fsError('ENOENT'));
    await expect(writeFileWithRetry('/x', BYTES, 3, 0, writeFn)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('treats EACCES (read-only file) as transient and retries', async () => {
    const writeFn = vi.fn().mockRejectedValue(fsError('EACCES'));
    await expect(writeFileWithRetry('/x', BYTES, 2, 0, writeFn)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(writeFn).toHaveBeenCalledTimes(2);
  });
});
