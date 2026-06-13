import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildDiffModel, type DiffModel } from './diffModel';

/**
 * Diff model wrapper tests. The actual diff algorithm runs in Rust and is
 * tested there (src-tauri/src/diff.rs). These tests verify the thin async
 * wrapper handles edge cases (identical text short-circuit, IPC error fallback).
 */

const mockCompute = vi.fn();

beforeEach(() => {
  mockCompute.mockReset();
  (globalThis as unknown as { window: { notepads: { diff: { compute: typeof mockCompute } } } }).window = {
    notepads: { diff: { compute: mockCompute } }
  };
});

describe('buildDiffModel', () => {
  it('identical text → empty model without calling Rust', async () => {
    const m = await buildDiffModel('a\nb\nc', 'a\nb\nc');
    expect(m.left).toEqual([]);
    expect(m.right).toEqual([]);
    expect(mockCompute).not.toHaveBeenCalled();
  });

  it('different text → calls Rust and returns the model', async () => {
    const fakeModel: DiffModel = {
      left: [{ kind: 'deleted', text: 'old' }],
      right: [{ kind: 'inserted', text: 'new' }]
    };
    mockCompute.mockResolvedValue({ ok: true, data: fakeModel });

    const m = await buildDiffModel('old', 'new');
    expect(mockCompute).toHaveBeenCalledWith('old', 'new');
    expect(m).toEqual(fakeModel);
  });

  it('IPC error → returns empty model', async () => {
    mockCompute.mockResolvedValue({ ok: false, error: 'fail' });

    const m = await buildDiffModel('a', 'b');
    expect(m.left).toEqual([]);
    expect(m.right).toEqual([]);
  });
});
