/**
 * DiffViewer component test (Lane B, Phase 6). Asserts row alignment in the DOM,
 * the per-row kind data-attrs (for color coding), modified char-level pieces, and
 * synced scroll (left mirrors right and vice-versa). Diff computation is mocked
 * (the algorithm is tested in Rust).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiffViewer } from './DiffViewer';
import type { DiffModel } from './diffModel';

function mockDiffResult(model: DiffModel) {
  (window as unknown as Record<string, unknown>).notepads = {
    diff: {
      compute: vi.fn().mockResolvedValue({ ok: true, data: model })
    }
  };
}

describe('DiffViewer', () => {
  beforeEach(() => {
    mockDiffResult({ left: [], right: [] });
  });

  it('renders both columns with equal row counts (aligned)', async () => {
    mockDiffResult({
      left: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'modified', text: 'b', pieces: [{ text: 'b', kind: 'deleted' }] },
        { kind: 'unchanged', text: 'c' }
      ],
      right: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'modified', text: 'B', pieces: [{ text: 'B', kind: 'inserted' }] },
        { kind: 'unchanged', text: 'c' }
      ]
    });
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    await waitFor(() => {
      const left = screen.getByTestId('diff-column-left');
      expect(left.children.length).toBeGreaterThan(0);
    });
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(left.children.length).toBe(right.children.length);
  });

  it('marks a modified line with kind=modified on both columns', async () => {
    mockDiffResult({
      left: [
        {
          kind: 'modified',
          text: 'hello world',
          pieces: [
            { text: 'hello ', kind: 'unchanged' },
            { text: 'world', kind: 'deleted' }
          ]
        }
      ],
      right: [
        {
          kind: 'modified',
          text: 'hello there',
          pieces: [
            { text: 'hello ', kind: 'unchanged' },
            { text: 'there', kind: 'inserted' }
          ]
        }
      ]
    });
    render(<DiffViewer original="hello world" modified="hello there" />);
    await waitFor(() => {
      expect(
        screen.getByTestId('diff-column-left').querySelector('[data-row-kind="modified"]')
      ).not.toBeNull();
    });
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(left.querySelector('[data-row-kind="modified"]')).not.toBeNull();
    expect(right.querySelector('[data-row-kind="modified"]')).not.toBeNull();
    expect(left.querySelector('[data-piece-kind="deleted"]')).not.toBeNull();
    expect(right.querySelector('[data-piece-kind="inserted"]')).not.toBeNull();
  });

  it('renders an inserted line with an imaginary filler opposite it', async () => {
    mockDiffResult({
      left: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'imaginary', text: '' },
        { kind: 'unchanged', text: 'c' }
      ],
      right: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'inserted', text: 'b' },
        { kind: 'unchanged', text: 'c' }
      ]
    });
    render(<DiffViewer original={'a\nc'} modified={'a\nb\nc'} />);
    await waitFor(() => {
      expect(
        screen.getByTestId('diff-column-right').querySelector('[data-row-kind="inserted"]')
      ).not.toBeNull();
    });
    const left = screen.getByTestId('diff-column-left');
    expect(left.querySelector('[data-row-kind="imaginary"]')).not.toBeNull();
  });

  it('renders a deleted line with an imaginary filler opposite it', async () => {
    mockDiffResult({
      left: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'deleted', text: 'b' },
        { kind: 'unchanged', text: 'c' }
      ],
      right: [
        { kind: 'unchanged', text: 'a' },
        { kind: 'imaginary', text: '' },
        { kind: 'unchanged', text: 'c' }
      ]
    });
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nc'} />);
    await waitFor(() => {
      expect(
        screen.getByTestId('diff-column-left').querySelector('[data-row-kind="deleted"]')
      ).not.toBeNull();
    });
    const right = screen.getByTestId('diff-column-right');
    expect(right.querySelector('[data-row-kind="imaginary"]')).not.toBeNull();
  });

  it('synchronizes scroll from left to right', async () => {
    mockDiffResult({
      left: [{ kind: 'unchanged', text: 'a' }],
      right: [{ kind: 'unchanged', text: 'a' }]
    });
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    await waitFor(() => {
      expect(screen.getByTestId('diff-column-left').children.length).toBeGreaterThan(0);
    });
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    left.scrollTop = 40;
    fireEvent.scroll(left);
    expect(right.scrollTop).toBe(40);
  });

  it('synchronizes scroll from right to left', async () => {
    mockDiffResult({
      left: [{ kind: 'unchanged', text: 'a' }],
      right: [{ kind: 'unchanged', text: 'a' }]
    });
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    await waitFor(() => {
      expect(screen.getByTestId('diff-column-right').children.length).toBeGreaterThan(0);
    });
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    right.scrollTop = 25;
    fireEvent.scroll(right);
    expect(left.scrollTop).toBe(25);
  });
});
