/**
 * DiffViewer component test (Lane B, Phase 6). Asserts row alignment in the DOM,
 * the per-row kind data-attrs (for color coding), modified char-level pieces, and
 * synced scroll (left mirrors right and vice-versa). Diff-model correctness itself
 * is covered by diffModel.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from './DiffViewer';

describe('DiffViewer', () => {
  it('renders both columns with equal row counts (aligned)', () => {
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(left.children.length).toBe(right.children.length);
  });

  it('marks a modified line with kind=modified on both columns', () => {
    render(<DiffViewer original="hello world" modified="hello there" />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(left.querySelector('[data-row-kind="modified"]')).not.toBeNull();
    expect(right.querySelector('[data-row-kind="modified"]')).not.toBeNull();
    // The modified row carries char-level pieces (the changed span is tinted).
    expect(left.querySelector('[data-piece-kind="deleted"]')).not.toBeNull();
    expect(right.querySelector('[data-piece-kind="inserted"]')).not.toBeNull();
  });

  it('renders an inserted line with an imaginary filler opposite it', () => {
    render(<DiffViewer original={'a\nc'} modified={'a\nb\nc'} />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(right.querySelector('[data-row-kind="inserted"]')).not.toBeNull();
    expect(left.querySelector('[data-row-kind="imaginary"]')).not.toBeNull();
  });

  it('renders a deleted line with an imaginary filler opposite it', () => {
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nc'} />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    expect(left.querySelector('[data-row-kind="deleted"]')).not.toBeNull();
    expect(right.querySelector('[data-row-kind="imaginary"]')).not.toBeNull();
  });

  it('synchronizes scroll from left to right', () => {
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    left.scrollTop = 40;
    fireEvent.scroll(left);
    expect(right.scrollTop).toBe(40);
  });

  it('synchronizes scroll from right to left', () => {
    render(<DiffViewer original={'a\nb\nc'} modified={'a\nB\nc'} />);
    const left = screen.getByTestId('diff-column-left');
    const right = screen.getByTestId('diff-column-right');
    right.scrollTop = 25;
    fireEvent.scroll(right);
    expect(left.scrollTop).toBe(25);
  });
});
