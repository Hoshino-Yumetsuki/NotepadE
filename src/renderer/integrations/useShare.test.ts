import { describe, it, expect, vi, afterEach } from 'vitest';
import { shareDocument } from './useShare';

/**
 * Share integration test (Lane B, Phase 6). Asserts shareDocument forwards the
 * title + text to MAIN's shell.share and swallows bridge errors (best-effort).
 */

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).notepads;
});

describe('shareDocument', () => {
  it('forwards title + text to the share bridge', async () => {
    const share = vi.fn().mockResolvedValue({ ok: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).notepads = { shell: { share } };
    await shareDocument({ title: 'doc', text: 'body' });
    expect(share).toHaveBeenCalledWith({ title: 'doc', text: 'body' });
  });

  it('swallows a rejecting bridge (best-effort, never throws)', async () => {
    const share = vi.fn().mockRejectedValue(new Error('no share'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).notepads = { shell: { share } };
    await expect(shareDocument({ title: 'x', text: 'y' })).resolves.toBeUndefined();
  });

  it('does not throw when the bridge is unavailable', async () => {
    await expect(shareDocument({ title: 'x', text: 'y' })).resolves.toBeUndefined();
  });
});
